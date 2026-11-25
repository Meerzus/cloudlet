import { formatColor, oklchToRgb, parseColor, rgbToOklch, type Rgba } from '@/components/ui/color-picker/color';

/**
 * The color picker landing's ramps (COLOR_PICKER §8.2). The material's frames carry form, light and
 * grain but no color of their own: a pixel's brightness is its place on a ramp, and the ramp comes
 * from the picked color (the hero) or from a palette (the Palette card). Stops are chosen in OKLCH,
 * interpolated in OKLab and handed to the shader as a 256-entry lookup table.
 */

/**
 * Dark or light. A ramp's scene is the picked color's lightness and shapes its stops; the page's scene —
 * which end of the ramp is paper under the copy — is the site's theme (`themeOf`, §8.2).
 */
export type Scene = 'dark' | 'light';

/** OKLCH lightness under which a color makes a dark scene. */
export const DARK_BELOW = 0.45;

/** One stop: its place on the ramp in [0, 1] and its color as `#rrggbb`. */
export interface RampStop {
  readonly at: number;
  readonly color: string;
}

export interface Ramp {
  readonly scene: Scene;
  /** Read the frame upside down: its pale paper becomes the deep end, where light ink can sit (§8.2). */
  readonly invert: boolean;
  readonly stops: readonly RampStop[];
}

/** Entries of the lookup table the shader samples. */
export const LUT_SIZE = 256;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const mod360 = (degrees: number) => ((degrees % 360) + 360) % 360;
const hex = (l: number, c: number, h: number) => formatColor(oklchToRgb({ l: clamp(l, 0, 1), c: Math.max(0, c), h: mod360(h), a: 1 }), 'hex');

const opaque = (input: string): Rgba | null => {
  const rgba = parseColor(input);
  return rgba ? { ...rgba, a: 1 } : null;
};

export const sceneOf = (lightness: number): Scene => (lightness < DARK_BELOW ? 'dark' : 'light');

/**
 * The hero's ramp for one color, after the moodboard's `rampFor()`. The color itself holds the
 * middle tones; its neighbours (24–40° of hue away) the half-shadows and the lights; the ends are
 * nearly black and nearly white. A light scene keeps the complement as a narrow accent in the very
 * deepest shadow; a dark scene builds its lights from a neighbour only — on the moodboard a
 * complement there made a yellow-violet frame dominated by a color nobody picked.
 *
 * Chroma of the derived stops follows the picked color's own: a grey or a near-white pick makes a
 * grey ramp instead of borrowing a hue from float noise.
 */
export function heroRamp(input: string): Ramp | null {
  const rgba = opaque(input);
  if (!rgba) return null;
  const { l: L, c: C, h: H } = rgbToOklch(rgba);
  const own = formatColor(rgba, 'hex');
  // Full moodboard chroma from C = 0.1 up; less for greyish colors, none for greys.
  const k = clamp(C / 0.1, 0, 1);
  if (sceneOf(L) === 'dark') {
    return {
      scene: 'dark',
      invert: true,
      stops: [
        // Never above the pick: a near-black stays the deepest tone of its own scene.
        { at: 0, color: hex(Math.min(0.1, L * 0.5), 0.03 * k, H) },
        { at: 0.3, color: own },
        { at: 0.58, color: hex(0.56, Math.max(C, 0.12) * k, H + 40) },
        { at: 0.82, color: hex(0.76, 0.1 * k, H + 40) },
        { at: 1, color: hex(0.94, 0.03 * k, H + 40) },
      ],
    };
  }
  return {
    scene: 'light',
    invert: false,
    stops: [
      { at: 0, color: hex(0.22, 0.09 * k, H + 180) },
      // Half-shadows below the pick even when it is barely light.
      { at: 0.32, color: hex(Math.min(0.48, L * 0.7), 0.15 * k, H - 38) },
      { at: 0.6, color: own },
      // A very light pick keeps the lights above itself, so the ramp still rises to the paper.
      // The lights cover the frame's paper, the largest calm area: a softer neighbour than the moodboard's (0.09, +38°),
      // which turned a green's paper cyan.
      { at: 0.85, color: hex(Math.max(0.89, Math.min(0.95, L + 0.03)), 0.06 * k, H + 24) },
      { at: 1, color: hex(0.975, 0.02 * k, H) },
    ],
  };
}

/**
 * The Palette card's ramp (COLOR_PALETTE, §8.2): the visitor's 1–4 colors laid out by lightness,
 * the darkest in the shadows, not in the order they were added; the ends are built by darkening the
 * darkest and lightening the lightest. One color is the hero's ramp. The scene follows the first
 * color (the page's), as the hero's does; the card reads the frame upright either way.
 */
export function paletteRamp(inputs: readonly string[]): Ramp | null {
  const colors = inputs.map(opaque).filter((rgba): rgba is Rgba => rgba !== null);
  if (colors.length === 0) return null;
  if (colors.length === 1) return heroRamp(formatColor(colors[0]!, 'hex'));
  const first = rgbToOklch(colors[0]!);
  const sorted = colors.map((rgba) => ({ hex: formatColor(rgba, 'hex'), ...rgbToOklch(rgba) })).sort((p, q) => p.l - q.l);
  const darkest = sorted[0]!;
  const lightest = sorted[sorted.length - 1]!;
  // The colors spread evenly over the middle of the ramp, the ends left to the built extremes.
  const inner = sorted.map((color, index) => ({ at: 0.18 + (0.64 * index) / (sorted.length - 1), color: color.hex }));
  return {
    scene: sceneOf(first.l),
    invert: false,
    stops: [
      // A night deep enough for the dark theme's text whatever the palette: a palette of pastels alone left
      // its darkest end at L 0.36, and the lifted paper under the copy at 4:1.
      { at: 0, color: hex(Math.min(0.12, darkest.l * 0.4), darkest.c * 0.6, darkest.h) },
      ...inner,
      { at: 1, color: hex(lightest.l + (1 - lightest.l) * 0.75, lightest.c * 0.25, lightest.h) },
    ],
  };
}

type Lab = readonly [number, number, number];

const toLab = (color: string): Lab => {
  const { l, c, h } = rgbToOklch(parseColor(color)!);
  const radians = (h * Math.PI) / 180;
  return [l, c * Math.cos(radians), c * Math.sin(radians)];
};

const fromLab = ([l, a, b]: Lab): Rgba => {
  const c = Math.hypot(a, b);
  return oklchToRgb({ l, c, h: c < 1e-6 ? 0 : (Math.atan2(b, a) * 180) / Math.PI, a: 1 });
};

/** The ramp's color at `t` in [0, 1], interpolated in OKLab between its stops (sRGB, gamut-clipped by chroma). */
export function sampleRamp(stops: readonly RampStop[], t: number): Rgba {
  const at = clamp(t, 0, 1);
  let index = 0;
  while (index < stops.length - 2 && at > stops[index + 1]!.at) index += 1;
  const low = stops[index]!;
  const high = stops[Math.min(index + 1, stops.length - 1)]!;
  const span = high.at - low.at;
  const u = span <= 0 ? 0 : clamp((at - low.at) / span, 0, 1);
  const p = toLab(low.color);
  const q = toLab(high.color);
  return fromLab([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u]);
}

/** The ramp as the shader's lookup table: LUT_SIZE RGBA8 texels, entry i at t = i / (LUT_SIZE − 1). */
export function rampLut(stops: readonly RampStop[]): Uint8Array {
  const out = new Uint8Array(LUT_SIZE * 4);
  for (let index = 0; index < LUT_SIZE; index += 1) {
    const { r, g, b } = sampleRamp(stops, index / (LUT_SIZE - 1));
    out.set([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255], index * 4);
  }
  return out;
}

/** One color over the whole table: the flat frame before the material arrives. */
export function flatLut(color: string): Uint8Array {
  const { r, g, b } = opaque(color) ?? { r: 0, g: 0, b: 0 };
  const out = new Uint8Array(LUT_SIZE * 4);
  for (let index = 0; index < LUT_SIZE; index += 1) out.set([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255], index * 4);
  return out;
}

/** The site's `--background` of each theme (globals.css), for the flat background below. */
export const THEME_BACKGROUND: Record<Scene, string> = {
  light: 'oklch(0.985 0.008 240)',
  dark: 'oklch(0.2 0.045 265)',
};

/** The site's `--foreground` of each theme (globals.css): the ink of the copy over the paint. */
export const THEME_FOREGROUND: Record<Scene, string> = {
  light: 'oklch(0.13 0.04 258)',
  dark: 'oklch(0.97 0.01 250)',
};

/** Share of the picked color in the flat background; the rest is the theme's background. */
export const FLAT_AMOUNT = 0.35;

/**
 * How light the flat background may get: at most this in the dark theme, at least this in the light
 * one. The muted text of either theme keeps 4.5:1 on it (a white page color in the dark theme mixed
 * to L 0.48, where the muted text had 3.4:1). picker.css clamps the same.
 */
export const FLAT_LIGHTNESS: Record<Scene, { readonly min: number; readonly max: number }> = {
  light: { min: 0.64, max: 1 },
  dark: { min: 0, max: 0.4 },
};

/**
 * The flat background of the page before the paint draws, and for good without WebGL 2 (§8.3): the
 * picked color mixed into the theme's background in OKLCH, its lightness kept within FLAT_LIGHTNESS.
 * picker.css writes the same `color-mix(in oklch, var(--cp-color) 35%, var(--background))`, clamped.
 */
export function flatOf(input: string, theme: Scene): string | null {
  const rgba = opaque(input);
  if (!rgba) return null;
  const color = rgbToOklch(rgba);
  const background = rgbToOklch(parseColor(THEME_BACKGROUND[theme])!);
  const mix = (p: number, q: number) => p * FLAT_AMOUNT + q * (1 - FLAT_AMOUNT);
  // Hue along the shorter arc; a grey has no hue of its own and takes the background's.
  let hue = background.h;
  if (color.c > 1e-4) {
    const gap = ((((background.h - color.h) % 360) + 540) % 360) - 180;
    hue = color.h + gap * (1 - FLAT_AMOUNT);
  }
  const { min, max } = FLAT_LIGHTNESS[theme];
  return hex(Math.min(max, Math.max(min, mix(color.l, background.l))), mix(color.c, background.c), hue);
}

/** The scene the theme picks (§8.2): the dark theme reads the frame upside down. */
export const themeOf = (root: Element): Scene => (root.classList.contains('dark') ? 'dark' : 'light');

/** The ramp that paints the page: the palette's once the visitor made it theirs, the page color's until then. */
export const pageRamp = (state: { readonly ramp: Ramp; readonly paletteRamp: Ramp; readonly own: boolean }): Ramp => (state.own ? state.paletteRamp : state.ramp);

/** WCAG 2 contrast ratio of two sRGB colors. */
export function contrast(p: Rgba, q: Rgba): number {
  const luminance = ({ r, g, b }: Rgba) => {
    const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  };
  const [high, low] = [luminance(p), luminance(q)].sort((a, b) => b - a);
  return (high! + 0.05) / (low! + 0.05);
}
