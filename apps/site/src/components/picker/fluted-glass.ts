import {
  flutedGlassFragmentShader,
  GlassDistortionShapes,
  GlassGridShapes,
  ShaderFitOptions,
  ShaderMount,
  type GlassDistortionShape,
  type GlassGridShape,
} from '@paper-design/shaders';

/**
 * The fluted glass of Opacity and Tools (COLOR_PICKER §8.8): Paper Shaders' FlutedGlass over a frame
 * in its own colors, with the scene drifting slowly behind glass that stays put.
 *
 * Paper's shader lays its ribs out in the image's coordinates, so its own offset moves the glass along
 * with the picture. One line is added to it (Apache-2.0, see THIRD_PARTY_NOTICES.md): after the ribs
 * have bent the coordinates, the picture is read zoomed in by `u_zoom` and shifted by `u_drift`, so the
 * ribs keep their place on the card while the frame slides under them. The zoom is the drift's room:
 * the shifted picture never runs out of its edges.
 */

/** The look of the glass: Paper's FlutedGlass parameters, the ones we tune. */
export interface GlassLook {
  readonly size: number;
  readonly shape: GlassGridShape;
  readonly distortionShape: GlassDistortionShape;
  readonly distortion: number;
  readonly angle: number;
  readonly shift: number;
  readonly blur: number;
  readonly edges: number;
  readonly stretch: number;
  readonly highlights: number;
  readonly shadows: number;
  readonly grainMixer: number;
  readonly grainOverlay: number;
}

/** How far the scene drifts, as a share of the frame, and how long one loop takes (§8.3). */
export const DRIFT = { amplitude: 0.03, period: 36_000, fps: 30 } as const;
/** The picture is zoomed in by this much so a full drift stays inside it. */
export const DRIFT_ZOOM = 1 - 2 * DRIFT.amplitude;
/** No more than 1.5 device pixels per CSS pixel (§8.9). */
const MAX_DPR = 1.5;

const PATCH_UNIFORMS = 'uniform float u_grainOverlay;';
const PATCH_SAMPLE = 'uv = mix(v_imageUV, uv, smoothstep(0., .7, mask));';

/** Paper's fragment shader with the drift added; throws if the pinned version no longer has the lines it hooks into. */
export function driftingGlassShader(source: string = flutedGlassFragmentShader): string {
  if (!source.includes(PATCH_UNIFORMS) || !source.includes(PATCH_SAMPLE)) {
    throw new Error('fluted-glass: the Paper shader changed, the drift patch no longer applies');
  }
  return source
    .replace(PATCH_UNIFORMS, `${PATCH_UNIFORMS}\nuniform vec2 u_drift;\nuniform float u_zoom;`)
    .replace(PATCH_SAMPLE, `${PATCH_SAMPLE}\n  uv = (uv - .5) * u_zoom + .5 + u_drift;`);
}

/** The drift at a moment: a slow loop, wider than tall (a Lissajous 1 : 2), inside ±amplitude. */
export function driftAt(time: number): readonly [number, number] {
  const phase = ((time % DRIFT.period) / DRIFT.period) * Math.PI * 2;
  return [DRIFT.amplitude * Math.sin(phase), DRIFT.amplitude * 0.6 * Math.sin(phase * 2 + Math.PI / 3)];
}

const lookUniforms = (look: GlassLook) => ({
  u_size: look.size,
  u_shape: GlassGridShapes[look.shape],
  u_distortionShape: GlassDistortionShapes[look.distortionShape],
  u_distortion: look.distortion,
  u_angle: look.angle,
  u_shift: look.shift,
  u_blur: look.blur,
  u_edges: look.edges,
  u_stretch: look.stretch,
  u_highlights: look.highlights,
  u_shadows: look.shadows,
  u_grainMixer: look.grainMixer,
  u_grainOverlay: look.grainOverlay,
});

/** Can this browser draw the glass? Paper needs WebGL 2. */
export function hasWebGl2(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

/**
 * One fluted glass card. Paper's ShaderMount owns the canvas (prepended into `host`) and redraws when a
 * uniform changes; the drift loop here sets `u_drift` at 30 fps while the card is moving and active.
 */
export class FlutedScene {
  private readonly mount: ShaderMount;
  private readonly resize: ResizeObserver;
  private moving = false;
  private active = true;
  private frame = 0;
  private last = 0;
  private time = 0;

  private constructor(private readonly host: HTMLElement, image: HTMLImageElement, look: GlassLook) {
    this.mount = new ShaderMount(
      host,
      driftingGlassShader(),
      {
        u_image: image,
        u_colorBack: [0, 0, 0, 0],
        u_colorShadow: [0, 0, 0, 1],
        u_colorHighlight: [1, 1, 1, 1],
        u_marginLeft: 0,
        u_marginRight: 0,
        u_marginTop: 0,
        u_marginBottom: 0,
        u_fit: ShaderFitOptions.cover,
        u_scale: 1,
        u_rotation: 0,
        u_offsetX: 0,
        u_offsetY: 0,
        u_originX: 0.5,
        u_originY: 0.5,
        u_worldWidth: 0,
        u_worldHeight: 0,
        u_zoom: DRIFT_ZOOM,
        u_drift: [0, 0],
        ...lookUniforms(look),
      },
      { alpha: true, premultipliedAlpha: true },
      0,
      0,
      1,
      undefined,
      ['u_image'],
    );
    this.resize = new ResizeObserver(() => this.cap());
    this.resize.observe(host);
    this.cap();
  }

  /** The glass on `host` over a decoded image; null without WebGL 2 or when the shader does not compile. */
  static create(host: HTMLElement, image: HTMLImageElement, look: GlassLook): FlutedScene | null {
    if (!hasWebGl2()) return null;
    try {
      return new FlutedScene(host, image, look);
    } catch {
      return null;
    }
  }

  /** The canvas Paper drew into: the caller hides it behind the plain picture if the context is lost. */
  get canvas(): HTMLCanvasElement {
    return this.mount.canvasElement;
  }

  /** Where the drift has the picture now (zero while still): a click reads the frame where it is shown. */
  get drift(): readonly [number, number] {
    return this.moving ? driftAt(this.time) : [0, 0];
  }

  /** How far the picture is zoomed in to leave the drift its room. */
  get zoom(): number {
    return DRIFT_ZOOM;
  }

  setLook(look: GlassLook): void {
    this.mount.setUniforms(lookUniforms(look));
  }

  /** Drift (true) or hold the frame still in the middle (reduced motion). */
  setMoving(moving: boolean): void {
    this.moving = moving;
    if (!moving) this.mount.setUniforms({ u_drift: [0, 0] });
    this.loop();
  }

  /** On screen and in a visible tab: off stops the loop where it is. */
  setActive(active: boolean): void {
    this.active = active;
    this.loop();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.resize.disconnect();
    this.mount.dispose();
  }

  /** Keeps the drawing buffer at ≤ 1.5 device pixels per CSS pixel. */
  private cap() {
    const { width, height } = this.host.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    if (width > 0 && height > 0) this.mount.setMaxPixelCount(Math.ceil(width * ratio) * Math.ceil(height * ratio));
  }

  private loop() {
    const run = this.moving && this.active;
    if (!run) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      return;
    }
    if (this.frame) return;
    this.last = performance.now();
    const step = (now: number) => {
      this.frame = requestAnimationFrame(step);
      const elapsed = now - this.last;
      if (elapsed < 1000 / DRIFT.fps - 2) return;
      // A long pause (a hidden tab the browser kept running) does not jump the scene.
      this.time += Math.min(elapsed, 100);
      this.last = now;
      this.mount.setUniforms({ u_drift: [...driftAt(this.time)] });
    };
    this.frame = requestAnimationFrame(step);
  }
}
