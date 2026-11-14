import { CYCLE_MS, FLOW, FLOW_FPS, tileSize, type Size } from '@/lib/paint-layout';
import type { CalmMap, PageRect } from '@/lib/paint-calm';
import { LUT_SIZE } from '@/lib/picker-ramp';
import { PAINT_FRAGMENT, PAINT_VERTEX } from './paint-shader';

/** Where a new ramp spreads from: a control's box in page coordinates (a point is an empty box), with its corner radius. */
export type BleedOrigin = PageRect & { readonly radius: number };

export interface PaintLayout {
  /**
   * `fixed`: the canvas covers the window and is drawn again on every scroll (the paint moves with the
   * page). `page`: it covers the whole page at a reduced scale and is drawn only on a change, so
   * scrolling costs nothing — for a software WebGL, where one full-screen pass takes 60–80 ms.
   */
  readonly mode: 'fixed' | 'page';
  /** The window, CSS px: the frame spans its width (tileSize) and a bleed reaches its corners. */
  readonly viewport: Size;
  /** The page's height, CSS px: the canvas' height in `page` mode. */
  readonly pageHeight: number;
  /** The fixed header's height, CSS px: the paper is lifted under it in `fixed` mode. */
  readonly header: number;
  readonly calm: CalmMap;
}

/** Length of a bleed (§8.3). */
export const BLEED_MS = 700;
/** Device px per CSS px, at most (§8.9). */
const MAX_DPR = 1.5;
/** `page` mode: device px per CSS px, and the canvas' longest side. */
const PAGE_SCALE = 0.5;
const PAGE_MAX = 8192;
/** The frame's brightness under the copy, at least: close to the ramp's end, where both ramps keep their paper. */
export const LIFT = 0.97;
const GRAIN = 0.05;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

const UNIFORMS = [
  'uMaterial',
  'uFrom',
  'uTo',
  'uCalm',
  'uCalmSize',
  'uSize',
  'uDpr',
  'uScroll',
  'uWidth',
  'uTile',
  'uPhase',
  'uFlow',
  'uHeader',
  'uInvert',
  'uLift',
  'uOrigin',
  'uOriginRadius',
  'uBleed',
  'uReach',
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
 * Draws the paint under the whole color picker landing with raw WebGL 2 (COLOR_PICKER §8.2–§8.3,
 * §8.9): one long frame laid along the page, one ramp, the paper lifted under the copy, a slow flow
 * and a bleed out of a control when the ramp jumps. Discipline: at most 1.5 device px per CSS px;
 * frames only while active (a visible tab), at FLOW_FPS while it only flows, every frame while it
 * scrolls or bleeds; still (no flow, no bleed) when motion is off.
 */
export class PaintRenderer {
  /** A renderer showing `lut` over a blank frame, or null when there is no WebGL 2 or the shader does not compile. */
  static create(canvas: HTMLCanvasElement, lut: Uint8Array): PaintRenderer | null {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    if (!gl) return null;
    const vertex = compile(gl, gl.VERTEX_SHADER, PAINT_VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, PAINT_FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    return new PaintRenderer(canvas, gl, program, lut);
  }

  private readonly locations: Record<Uniform, WebGLUniformLocation | null>;
  private readonly vao: WebGLVertexArrayObject | null;
  private readonly material: WebGLTexture | null;
  private readonly luts: [WebGLTexture | null, WebGLTexture | null];
  private readonly calm: WebGLTexture | null;
  private to: Uint8Array;
  private layout: PaintLayout | null = null;
  private aspect = 1 / 3;
  private scale = 1;
  private scroll = 0;
  private invert = false;
  private origin: BleedOrigin | null = null;
  private reach = 0;
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
    lut: Uint8Array,
  ) {
    this.to = lut;
    this.vao = gl.createVertexArray();
    this.locations = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)])) as Record<Uniform, WebGLUniformLocation | null>;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.material = texture(gl, gl.LINEAR_MIPMAP_LINEAR);
    // Until a frame arrives: one white texel, so a flat ramp shows as it is.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.generateMipmap(gl.TEXTURE_2D);
    this.luts = [texture(gl, gl.LINEAR), texture(gl, gl.LINEAR)];
    this.upload(0, lut);
    this.upload(1, lut);
    this.calm = texture(gl, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
  }

  /** Puts the decoded long frame (an <img>, a bitmap) under the ramp; redraws once. */
  setFrame(source: TexImageSource, width: number, height: number) {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.material);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.aspect = width / Math.max(1, height);
    this.hasFrame = true;
    this.touch();
  }

  /** Sizes the drawing buffer for the mode and takes the page's calm map; draws at once. */
  setLayout(layout: PaintLayout) {
    const { gl } = this;
    const { viewport, pageHeight } = layout;
    const height = layout.mode === 'fixed' ? viewport.height : pageHeight;
    this.scale = layout.mode === 'fixed' ? Math.min(MAX_DPR, window.devicePixelRatio || 1) : Math.min(PAGE_SCALE, PAGE_MAX / Math.max(1, height, viewport.width));
    const w = Math.max(1, Math.round(viewport.width * this.scale));
    const h = Math.max(1, Math.round(height * this.scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (layout.calm !== this.layout?.calm) {
      gl.bindTexture(gl.TEXTURE_2D, this.calm);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, layout.calm.width, layout.calm.height, 0, gl.RED, gl.UNSIGNED_BYTE, layout.calm.data);
    }
    this.layout = layout;
    this.stale = true;
    this.draw(performance.now());
  }

  /** The page's scroll, CSS px: a `fixed` canvas draws the part of the page in the window. */
  setScroll(y: number) {
    if (y === this.scroll) return;
    this.scroll = y;
    if (this.layout?.mode === 'fixed') this.touch();
  }

  /** The dark theme reads the frame upside down: its paper is the deep end of the ramp. Shown at once. */
  setInvert(invert: boolean) {
    if (invert === this.invert) return;
    this.invert = invert;
    this.settle();
    this.touch();
  }

  /** Shows a ramp: at once (no origin, dragging, motion off) or spreading out of `origin` over BLEED_MS. */
  paint(lut: Uint8Array, origin: BleedOrigin | null) {
    if (origin && this.active && this.moving && this.layout) {
      // A jump during a bleed keeps the old paint underneath and restarts the spread with the new one.
      if (this.bleedStart === null) this.upload(0, this.to);
      this.origin = origin;
      this.reach = this.reachFrom(origin, this.layout.viewport) + 160;
      this.bleedStart = performance.now();
    } else {
      this.upload(0, lut);
      this.bleedStart = null;
    }
    this.to = lut;
    this.upload(1, lut);
    this.touch();
  }

  /** Motion off (reduced motion, a software WebGL): a still frame at the start of the cycle, no loop, no bleed. */
  setMoving(moving: boolean) {
    this.moving = moving;
    if (!moving) {
      this.clock = 0;
      this.settle();
    }
    this.touch();
  }

  /** In a visible tab: off, no frame is drawn; back on, the loop resumes. */
  setActive(active: boolean) {
    this.active = active;
    this.lastTick = null;
    if (!active) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      // A bleed never resumes later: the new paint is simply there.
      this.settle();
      this.stale = true;
    } else this.schedule();
  }

  /** Whether frames keep coming without a change: the flow runs. */
  get looping(): boolean {
    return this.active && this.moving && this.hasFrame && this.layout?.mode === 'fixed';
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const { gl } = this;
    gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    for (const handle of [this.material, this.calm, ...this.luts]) if (handle) gl.deleteTexture(handle);
  }

  /** Distance from the origin's centre to the farthest corner of the window, CSS px. */
  private reachFrom(origin: BleedOrigin, viewport: Size): number {
    const cx = origin.x + origin.width / 2;
    const cy = origin.y + origin.height / 2;
    const top = this.scroll;
    return Math.max(...[0, viewport.width].flatMap((x) => [top, top + viewport.height].map((y) => Math.hypot(x - cx, y - cy))));
  }

  /** Ends a running bleed: the new paint is simply there. */
  private settle() {
    if (this.bleedStart === null) return;
    this.upload(0, this.to);
    this.bleedStart = null;
  }

  private touch() {
    this.stale = true;
    this.schedule();
  }

  private upload(slot: 0 | 1, lut: Uint8Array) {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.luts[slot]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, LUT_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut);
  }

  private schedule() {
    if (!this.active || this.frame) return;
    if (!this.stale && !this.looping) return;
    this.frame = requestAnimationFrame((now) => {
      this.frame = 0;
      // Only flowing: hold to FLOW_FPS. A scroll, a bleed or a change draws on the next frame.
      if (!this.stale && this.bleedStart === null && now - this.lastDraw < 1000 / FLOW_FPS - 2) {
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
  private draw(now: number) {
    const { gl, layout, locations: u } = this;
    if (!layout || !this.active) return;
    this.tick(now);
    let progress = 1;
    if (this.bleedStart !== null) {
      progress = Math.min(1, (performance.now() - this.bleedStart) / BLEED_MS);
      if (progress >= 1) this.settle();
    }
    const fixed = layout.mode === 'fixed';
    const tile = tileSize(layout.viewport, this.aspect);
    const origin = this.origin ?? { x: 0, y: 0, width: 0, height: 0, radius: 0 };

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    [this.material, this.luts[0], this.luts[1], this.calm].forEach((handle, unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, handle);
    });
    gl.uniform1i(u.uMaterial, 0);
    gl.uniform1i(u.uFrom, 1);
    gl.uniform1i(u.uTo, 2);
    gl.uniform1i(u.uCalm, 3);
    gl.uniform2f(u.uCalmSize, layout.calm.width * layout.calm.scale, layout.calm.height * layout.calm.scale);
    gl.uniform2f(u.uSize, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uDpr, this.scale);
    gl.uniform1f(u.uScroll, fixed ? this.scroll : 0);
    gl.uniform1f(u.uWidth, layout.viewport.width);
    gl.uniform2f(u.uTile, tile.width, tile.height);
    gl.uniform1f(u.uPhase, (this.clock % CYCLE_MS) / CYCLE_MS);
    gl.uniform1f(u.uFlow, this.hasFrame && this.moving ? FLOW : 0);
    gl.uniform1f(u.uHeader, fixed ? layout.header : 0);
    gl.uniform1f(u.uInvert, this.invert ? 1 : 0);
    gl.uniform1f(u.uLift, LIFT);
    gl.uniform4f(u.uOrigin, origin.x + origin.width / 2, origin.y + origin.height / 2, origin.width / 2, origin.height / 2);
    gl.uniform1f(u.uOriginRadius, Math.min(origin.radius, origin.width / 2, origin.height / 2));
    gl.uniform1f(u.uBleed, this.bleedStart === null ? 1 : easeOut(progress));
    gl.uniform1f(u.uReach, this.reach);
    gl.uniform1f(u.uGrain, this.hasFrame ? GRAIN : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.lastDraw = now;
    this.stale = this.bleedStart !== null;
    this.schedule();
  }
}
