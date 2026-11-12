import { LUT_SIZE } from '@/lib/picker-ramp';
import { CALM_RECTS, FRAGMENT_SHADER, VERTEX_SHADER } from './material-shader';

/** A rectangle in CSS px from the canvas' top-left corner. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One ramp as the shader reads it: the lookup table and whether the frame is read upside down. */
export interface MaterialPaint {
  /** LUT_SIZE RGBA8 texels (`rampLut`, `flatLut`). */
  readonly lut: Uint8Array;
  readonly invert: boolean;
}

export interface MaterialLayout {
  /** The canvas' CSS box. */
  readonly width: number;
  readonly height: number;
  /** Which part of the frame stays in view when it is cropped to cover the canvas: 0–1 from its top-left. */
  readonly focus: { readonly x: number; readonly y: number };
  /** Where a new ramp spreads from (the picker panel), with its corner radius. */
  readonly origin: Rect & { readonly radius: number };
  /** Rectangles under the copy, at most CALM_RECTS: the frame's brightness is lifted there so the ink stays readable. */
  readonly calm: readonly Rect[];
}

export interface MaterialOptions {
  /** Flow amplitude as a share of the frame (§8.3: a few percent). */
  readonly flow: number;
  /** Flow cycle, ms (§8.3: 30–40 s). */
  readonly cycle: number;
  /** Still grain amplitude (§8.2: 4–6 %). */
  readonly grain: number;
  /** The frame's brightness under the copy, at least. */
  readonly calmLuminance: number;
  /** How far the lift under the copy fades out, CSS px. */
  readonly calmFeather: number;
  /** Frames per second while the material only flows; a bleed draws every frame. */
  readonly fps: number;
}

export const DEFAULT_MATERIAL: MaterialOptions = { flow: 0.03, cycle: 36_000, grain: 0.05, calmLuminance: 0.8, calmFeather: 150, fps: 30 };

/** Length of a bleed (§8.3). */
export const BLEED_MS = 700;
/** Device px per CSS px, at most (§8.9). */
const MAX_DPR = 1.5;
/** The frame is zoomed in this much past cover, so the flow never pulls its edge into view. */
const FLOW_ZOOM = 1.08;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

const UNIFORMS = [
  'uMaterial',
  'uFrom',
  'uTo',
  'uSize',
  'uDpr',
  'uFit',
  'uPhase',
  'uFlow',
  'uInvert',
  'uOrigin',
  'uOriginRadius',
  'uBleed',
  'uReach',
  'uCalm',
  'uCalmFeather',
  'uCalmLuminance',
  'uGrain',
] as const;
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

function texture(gl: WebGL2RenderingContext, filter: number): WebGLTexture | null {
  const handle = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, handle);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return handle;
}

/**
 * Draws a recolorable material into a canvas with raw WebGL 2 (COLOR_PICKER §8.9): one frame, one
 * ramp, a slow flow and a bleed when the ramp jumps. The hero uses it, and the Palette card will
 * with its own frame and ramp. Discipline: at most 1.5 device px per CSS px; frames only while
 * active (on screen, in a visible tab), at `fps` while it flows and every frame while it bleeds;
 * still (no flow, no loop) when motion is off.
 */
export class MaterialRenderer {
  /** A renderer showing `paint` over a blank frame, or null when there is no WebGL 2 or the shader does not compile. */
  static create(canvas: HTMLCanvasElement, paint: MaterialPaint, options: Partial<MaterialOptions> = {}): MaterialRenderer | null {
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
    return new MaterialRenderer(canvas, gl, program, paint, { ...DEFAULT_MATERIAL, ...options });
  }

  private readonly locations: Record<Uniform, WebGLUniformLocation | null>;
  private readonly vao: WebGLVertexArrayObject | null;
  private readonly material: WebGLTexture | null;
  private readonly luts: [WebGLTexture | null, WebGLTexture | null];
  private from: MaterialPaint;
  private to: MaterialPaint;
  private layout: MaterialLayout | null = null;
  private aspect = 1;
  private dpr = 1;
  /** Start of the running bleed (performance.now()), or null when the paint has settled. */
  private bleedStart: number | null = null;
  private frame = 0;
  private active = true;
  private moving = true;
  private hasFrame = false;
  private stale = true;
  /** Flow time, ms: advances only while frames are drawn, so the flow resumes where it was left. */
  private clock = 0;
  private lastTick: number | null = null;
  private lastDraw = 0;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    private readonly program: WebGLProgram,
    paint: MaterialPaint,
    private readonly options: MaterialOptions,
  ) {
    this.from = paint;
    this.to = paint;
    this.vao = gl.createVertexArray();
    this.locations = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)])) as Record<Uniform, WebGLUniformLocation | null>;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    this.material = texture(gl, gl.LINEAR_MIPMAP_LINEAR);
    // Until a frame arrives: one white texel, so the flat ramp shows as it is.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.generateMipmap(gl.TEXTURE_2D);
    this.luts = [texture(gl, gl.LINEAR), texture(gl, gl.LINEAR)];
    this.upload(0, paint.lut);
    this.upload(1, paint.lut);
  }

  /** Puts a decoded frame (an <img>, a bitmap) under the ramp; redraws once. */
  setFrame(source: TexImageSource, width: number, height: number) {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.material);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.aspect = width / Math.max(1, height);
    this.hasFrame = true;
    this.stale = true;
    this.schedule();
  }

  /** Sizes the drawing buffer to the canvas' CSS box and places the copy and the panel; draws at once. */
  setLayout(layout: MaterialLayout) {
    this.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(layout.width * this.dpr));
    const h = Math.max(1, Math.round(layout.height * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.layout = layout;
    this.stale = true;
    this.draw(performance.now());
  }

  /** Shows a ramp: at once (dragging, reduced motion) or spreading out of the origin over BLEED_MS. */
  paint(paint: MaterialPaint, bleed: boolean) {
    if (bleed && this.active) {
      // A jump during a bleed keeps the old paint underneath and restarts the spread with the new one.
      if (this.bleedStart === null) {
        this.from = this.to;
        this.upload(0, this.from.lut);
      }
      this.bleedStart = performance.now();
    } else {
      this.from = paint;
      this.upload(0, paint.lut);
      this.bleedStart = null;
    }
    this.to = paint;
    this.upload(1, paint.lut);
    this.stale = true;
    this.schedule();
  }

  /** Motion off (reduced motion): a still frame at the start of the cycle and no loop. */
  setMoving(moving: boolean) {
    this.moving = moving;
    if (!moving) this.clock = 0;
    this.stale = true;
    this.schedule();
  }

  /** On screen and in a visible tab: off, no frame is drawn; back on, the loop resumes. */
  setActive(active: boolean) {
    this.active = active;
    this.lastTick = null;
    if (!active) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      // A bleed never resumes later: the new paint is simply there.
      if (this.bleedStart !== null) {
        this.from = this.to;
        this.upload(0, this.from.lut);
        this.bleedStart = null;
      }
      this.stale = true;
    } else this.schedule();
  }

  /** Whether frames keep coming without a change: the flow runs. */
  get looping(): boolean {
    return this.active && this.moving && this.hasFrame;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const { gl } = this;
    gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    for (const handle of [this.material, ...this.luts]) if (handle) gl.deleteTexture(handle);
  }

  private upload(slot: 0 | 1, lut: Uint8Array) {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.luts[slot]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, LUT_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  }

  private schedule() {
    if (!this.active || this.frame) return;
    if (!this.stale && !this.looping) return;
    this.frame = requestAnimationFrame((now) => {
      this.frame = 0;
      // Only flowing: hold to `fps`. A bleed or a change draws on the next frame.
      if (!this.stale && this.bleedStart === null && now - this.lastDraw < 1000 / this.options.fps - 2) {
        this.tick(now);
        this.schedule();
        return;
      }
      this.draw(now);
    });
  }

  private tick(now: number) {
    if (this.moving && this.lastTick !== null) this.clock += Math.min(100, now - this.lastTick);
    this.lastTick = now;
  }

  /** Draws one frame now; keeps scheduling while it bleeds or flows. */
  draw(now: number) {
    const { gl, layout, locations: u, options } = this;
    if (!layout || !this.active) return;
    this.tick(now);
    let progress = 1;
    if (this.bleedStart !== null) {
      progress = Math.min(1, (performance.now() - this.bleedStart) / BLEED_MS);
      if (progress >= 1) {
        this.from = this.to;
        this.upload(0, this.from.lut);
        this.bleedStart = null;
      }
    }
    const { width, height } = this.canvas;
    const dpr = this.dpr;
    // Cover: the frame's visible window, zoomed a little past it for the flow, kept round the focus.
    const canvasAspect = width / height;
    const size = { x: Math.min(1, canvasAspect / this.aspect) / FLOW_ZOOM, y: Math.min(1, this.aspect / canvasAspect) / FLOW_ZOOM };
    const centre = { x: layout.focus.x * (1 - size.x) + size.x / 2, y: 1 - (layout.focus.y * (1 - size.y) + size.y / 2) };
    const { origin } = layout;
    const ox = (origin.x + origin.width / 2) * dpr;
    const oy = height - (origin.y + origin.height / 2) * dpr;
    const reach = Math.max(...[0, width].flatMap((x) => [0, height].map((y) => Math.hypot(x - ox, y - oy)))) + 160 * dpr;
    const calm = new Float32Array(CALM_RECTS * 4);
    layout.calm.slice(0, CALM_RECTS).forEach((rect, index) => {
      calm.set([rect.x * dpr, height - (rect.y + rect.height) * dpr, (rect.x + rect.width) * dpr, height - rect.y * dpr], index * 4);
    });
    // Unused rectangles sit far off the canvas.
    for (let index = layout.calm.length; index < CALM_RECTS; index += 1) calm.set([-1e5, -1e5, -1e5, -1e5], index * 4);

    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    [this.material, this.luts[0], this.luts[1]].forEach((handle, unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, handle);
    });
    gl.uniform1i(u.uMaterial, 0);
    gl.uniform1i(u.uFrom, 1);
    gl.uniform1i(u.uTo, 2);
    gl.uniform2f(u.uSize, width, height);
    gl.uniform1f(u.uDpr, dpr);
    gl.uniform4f(u.uFit, centre.x, centre.y, size.x, size.y);
    gl.uniform1f(u.uPhase, (this.clock % options.cycle) / options.cycle);
    gl.uniform1f(u.uFlow, this.hasFrame ? options.flow : 0);
    gl.uniform2f(u.uInvert, this.from.invert ? 1 : 0, this.to.invert ? 1 : 0);
    gl.uniform4f(u.uOrigin, ox, oy, (origin.width / 2) * dpr, (origin.height / 2) * dpr);
    gl.uniform1f(u.uOriginRadius, Math.min(origin.radius, origin.width / 2, origin.height / 2) * dpr);
    gl.uniform1f(u.uBleed, this.bleedStart === null ? 1 : easeOut(progress));
    gl.uniform1f(u.uReach, reach);
    gl.uniform4fv(u.uCalm, calm);
    gl.uniform1f(u.uCalmFeather, options.calmFeather * dpr);
    gl.uniform1f(u.uCalmLuminance, options.calmLuminance);
    gl.uniform1f(u.uGrain, this.hasFrame ? options.grain : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.lastDraw = now;
    this.stale = this.bleedStart !== null;
    this.schedule();
  }
}
