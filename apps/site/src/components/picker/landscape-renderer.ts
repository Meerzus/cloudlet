import { LANDSCAPE_FIELDS, landscapeUniforms, type Landscape } from '@/lib/landscape';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './landscape-shader';

/** Where the scene's pieces sit, in CSS px from the canvas' top-left corner. */
export interface LandscapeLayout {
  readonly disc: { readonly x: number; readonly y: number; readonly r: number };
  readonly cloud: { readonly x: number; readonly y: number; readonly width: number };
  /** Where the storm's bolt falls from: its x and its top. */
  readonly bolt: { readonly x: number; readonly top: number };
  /** Lake horizon and hill height, fractions of the height from the bottom. */
  readonly horizon: number;
  readonly hills: number;
}

/** The uniforms of one palette: nine colors and the effects. */
export interface Paint {
  readonly colors: Float32Array;
  readonly fx: readonly [stars: number, haze: number, rain: number];
}

export const paintOf = (landscape: Landscape): Paint => ({ colors: landscapeUniforms(landscape), fx: [landscape.stars, landscape.haze, landscape.rain] });

/** One flat color over every field: the sky the page shows before the landscape (and without WebGL 2). */
export function flatPaint(sky: readonly [number, number, number], disc: readonly [number, number, number]): Paint {
  const colors = new Float32Array(LANDSCAPE_FIELDS.length * 3);
  for (let index = 0; index < LANDSCAPE_FIELDS.length; index += 1) colors.set(LANDSCAPE_FIELDS[index] === 'disc' ? disc : sky, index * 3);
  return { colors, fx: [0, 0, 0] };
}

/** Length of a bleed (§8.3). */
export const BLEED_MS = 700;
/** Device px per CSS px, at most (§8.4). */
const MAX_DPR = 1.5;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

const UNIFORMS = ['uSize', 'uDpr', 'uDisc', 'uCloud', 'uLand', 'uBolt', 'uFrom', 'uFromFx', 'uTo', 'uToFx', 'uBleed'] as const;
type Uniform = (typeof UNIFORMS)[number];

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  if (process.env.NODE_ENV !== 'production') console.error(gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

/**
 * Draws the landscape into a canvas with raw WebGL 2. Discipline after Unfort's molten metal: a
 * frame only when something changed or while paint bleeds, never in a hidden tab or off screen,
 * at most 1.5 device px per CSS px; no idle loop at all.
 */
export class LandscapeRenderer {
  /** A renderer, or null when the browser has no WebGL 2 or the shader does not compile. */
  static create(canvas: HTMLCanvasElement, paint: Paint): LandscapeRenderer | null {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    if (!gl) return null;
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    return new LandscapeRenderer(canvas, gl, program, paint);
  }

  private readonly locations: Record<Uniform, WebGLUniformLocation | null>;
  private readonly vao: WebGLVertexArrayObject | null;
  private from: Paint;
  private to: Paint;
  private layout: LandscapeLayout | null = null;
  private dpr = 1;
  /** Start of the running bleed (performance.now()), or null when the paint has settled. */
  private bleedStart: number | null = null;
  private frame = 0;
  private active = true;
  private stale = true;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    private readonly program: WebGLProgram,
    paint: Paint,
  ) {
    this.from = paint;
    this.to = paint;
    this.vao = gl.createVertexArray();
    this.locations = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)])) as Record<Uniform, WebGLUniformLocation | null>;
  }

  /** Sizes the drawing buffer to the canvas' CSS box and places the scene; draws at once. */
  setLayout(width: number, height: number, layout: LandscapeLayout) {
    this.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(width * this.dpr));
    const h = Math.max(1, Math.round(height * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.layout = layout;
    this.stale = true;
    this.draw();
  }

  /** Shows a palette: at once (dragging, reduced motion) or bleeding out of the disc over BLEED_MS. */
  paint(paint: Paint, bleed: boolean) {
    if (bleed && this.active) {
      // A jump during a bleed keeps the old paint underneath and restarts the spread with the new one.
      if (this.bleedStart === null) this.from = this.to;
      this.bleedStart = performance.now();
    } else {
      this.from = paint;
      this.bleedStart = null;
    }
    this.to = paint;
    this.stale = true;
    this.schedule();
  }

  /** On screen and in a visible tab: off, no frame is drawn; back on, a changed scene is drawn once. */
  setActive(active: boolean) {
    this.active = active;
    if (!active) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      // A bleed never resumes later: the new paint is simply there.
      if (this.bleedStart !== null) {
        this.from = this.to;
        this.bleedStart = null;
        this.stale = true;
      }
    } else this.schedule();
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.gl.deleteProgram(this.program);
    if (this.vao) this.gl.deleteVertexArray(this.vao);
  }

  private schedule() {
    if (!this.active || this.frame || !this.stale) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  /** Draws one frame now; keeps scheduling while a bleed runs. */
  draw() {
    const { gl, layout, locations: u } = this;
    if (!layout || !this.active) return;
    let progress = 1;
    if (this.bleedStart !== null) {
      progress = Math.min(1, (performance.now() - this.bleedStart) / BLEED_MS);
      if (progress >= 1) {
        this.from = this.to;
        this.bleedStart = null;
      }
    }
    const { width, height } = this.canvas;
    const dpr = this.dpr;
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(u.uSize, width, height);
    gl.uniform1f(u.uDpr, dpr);
    gl.uniform3f(u.uDisc, layout.disc.x * dpr, height - layout.disc.y * dpr, layout.disc.r * dpr);
    gl.uniform3f(u.uCloud, layout.cloud.x * dpr, height - layout.cloud.y * dpr, layout.cloud.width * dpr);
    gl.uniform2f(u.uLand, layout.horizon, layout.hills);
    gl.uniform2f(u.uBolt, layout.bolt.x * dpr, height - layout.bolt.top * dpr);
    gl.uniform3fv(u.uFrom, this.from.colors);
    gl.uniform3f(u.uFromFx, ...this.from.fx);
    gl.uniform3fv(u.uTo, this.to.colors);
    gl.uniform3f(u.uToFx, ...this.to.fx);
    gl.uniform1f(u.uBleed, this.bleedStart === null ? 1 : easeOut(progress));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.stale = this.bleedStart !== null;
    this.schedule();
  }
}
