/**
 * Color math for the ColorPicker: parsing of CSS colors, conversions between sRGB, HSV, HSL and
 * OKLCH, and the canonical output strings. Pure functions, no DOM: the same input gives the same
 * result on the server, in the browser and in jsdom.
 *
 * The picker edits HSV (saturation × brightness area, hue, alpha); every other space is only an
 * input or output format. OKLCH follows Björn Ottosson's OKLab (https://bottosson.github.io/posts/oklab/).
 */

export type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'oklch';

export const COLOR_FORMATS: readonly ColorFormat[] = ['hex', 'rgb', 'hsl', 'oklch'];

/** Hue in degrees [0, 360), saturation, value and alpha in [0, 1]. */
export interface Hsva {
  readonly h: number;
  readonly s: number;
  readonly v: number;
  readonly a: number;
}

/** sRGB channels in [0, 1] (gamma-encoded) and alpha in [0, 1]. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** Lightness in [0, 1], chroma ≥ 0, hue in degrees [0, 360), alpha in [0, 1]. */
export interface Oklcha {
  readonly l: number;
  readonly c: number;
  readonly h: number;
  readonly a: number;
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const mod360 = (degrees: number) => ((degrees % 360) + 360) % 360;

// --- HSV / HSL ---------------------------------------------------------------------------------

export function hsvToRgb({ h, s, v, a }: Hsva): Rgba {
  const sector = mod360(h) / 60;
  const i = Math.floor(sector);
  const f = sector - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i % 6] as [number, number, number];
  return { r, g, b, a };
}

export function rgbToHsv({ r, g, b, a }: Rgba): Hsva {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = mod360(h * 60);
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max, a };
}

function hslToRgb(h: number, s: number, l: number, a: number): Rgba {
  const channel = (n: number) => {
    const k = (n + mod360(h) / 30) % 12;
    const amount = s * Math.min(l, 1 - l);
    return l - amount * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: channel(0), g: channel(8), b: channel(4), a };
}

function rgbToHsl({ r, g, b }: Rgba): { h: number; s: number; l: number } {
  const { h, s: hsvS, v } = rgbToHsv({ r, g, b, a: 1 });
  const l = v * (1 - hsvS / 2);
  const s = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
  return { h, s, l };
}

// --- OKLCH ------------------------------------------------------------------------------------

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear(L: number, A: number, B: number): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function rgbToOklch({ r, g, b, a }: Rgba): Oklcha {
  const [L, A, B] = linearToOklab(toLinear(r), toLinear(g), toLinear(b));
  const c = Math.hypot(A, B);
  // Near-grey colors have no meaningful hue: report 0 instead of float noise.
  const h = c < 1e-4 ? 0 : mod360((Math.atan2(B, A) * 180) / Math.PI);
  return { l: clamp01(L), c: c < 1e-4 ? 0 : c, h, a };
}

const GAMUT_EPSILON = 1e-4;

function oklchToLinearRgb(l: number, c: number, h: number): [number, number, number] {
  const radians = (h * Math.PI) / 180;
  return oklabToLinear(l, c * Math.cos(radians), c * Math.sin(radians));
}

const inGamut = (rgb: readonly number[]) => rgb.every((channel) => channel >= -GAMUT_EPSILON && channel <= 1 + GAMUT_EPSILON);

/**
 * OKLCH → sRGB. A color outside sRGB keeps its lightness and hue and loses chroma until it fits
 * (binary search), so a vivid oklch() input lands on the nearest color the picker can show.
 */
export function oklchToRgb({ l, c, h, a }: Oklcha): Rgba {
  const lightness = clamp01(l);
  let rgb = oklchToLinearRgb(lightness, c, h);
  if (!inGamut(rgb)) {
    let low = 0;
    let high = c;
    for (let i = 0; i < 24; i += 1) {
      const middle = (low + high) / 2;
      if (inGamut(oklchToLinearRgb(lightness, middle, h))) low = middle;
      else high = middle;
    }
    rgb = oklchToLinearRgb(lightness, low, h);
  }
  return { r: clamp01(toGamma(clamp01(rgb[0]))), g: clamp01(toGamma(clamp01(rgb[1]))), b: clamp01(toGamma(clamp01(rgb[2]))), a };
}

// --- Parsing ------------------------------------------------------------------------------------

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTION = /^(rgba?|hsla?|oklch)\(\s*(.*?)\s*\)$/i;

/** One numeric argument of a color function: a number, a percentage, an angle or `none`. */
interface Token {
  readonly value: number;
  readonly unit: '' | '%' | 'deg' | 'rad' | 'grad' | 'turn' | 'none';
}

function tokenize(body: string): { readonly channels: Token[]; readonly alpha: Token | null } | null {
  const [channelPart = '', alphaPart, extra] = body.split('/');
  if (extra !== undefined) return null;
  const parts = channelPart.trim().split(/\s*,\s*|\s+/).filter(Boolean);
  const legacy = channelPart.includes(',');
  let alphaSource = alphaPart?.trim() ?? null;
  if (legacy && parts.length === 4 && alphaSource === null) alphaSource = parts.pop() ?? null;
  if (parts.length !== 3) return null;
  if (alphaSource === '') return null;
  const channels = parts.map(token);
  if (channels.some((entry) => entry === null)) return null;
  const alpha = alphaSource === null ? null : token(alphaSource);
  if (alphaSource !== null && alpha === null) return null;
  return { channels: channels as Token[], alpha };
}

function token(text: string): Token | null {
  if (text === 'none') return { value: 0, unit: 'none' };
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/i.exec(text);
  if (!match) return null;
  return { value: Number(match[1]), unit: (match[2]?.toLowerCase() ?? '') as Token['unit'] };
}

const degrees = ({ value, unit }: Token): number | null => {
  switch (unit) {
    case '':
    case 'none':
    case 'deg':
      return value;
    case 'rad':
      return (value * 180) / Math.PI;
    case 'grad':
      return value * 0.9;
    case 'turn':
      return value * 360;
    default:
      return null;
  }
};

/** A channel given as a number on `scale` or as a percentage; `none` is 0. */
const fraction = ({ value, unit }: Token, scale: number): number | null =>
  unit === '%' ? clamp01(value / 100) : unit === '' || unit === 'none' ? clamp01(value / scale) : null;

const alphaOf = (entry: Token | null): number | null => (entry === null ? 1 : fraction(entry, 1));

/** Parses a hex, rgb(), hsl() or oklch() color into sRGB; `null` for anything else (var(), names). */
export function parseColor(input: string): Rgba | null {
  const text = input.trim();
  const hex = HEX.exec(text);
  if (hex) {
    let digits = hex[1] as string;
    if (digits.length < 6) digits = [...digits].map((d) => d + d).join('');
    const channel = (at: number) => parseInt(digits.slice(at, at + 2), 16) / 255;
    return { r: channel(0), g: channel(2), b: channel(4), a: digits.length === 8 ? channel(6) : 1 };
  }
  const call = FUNCTION.exec(text);
  if (!call) return null;
  const name = (call[1] as string).toLowerCase();
  const parsed = tokenize(call[2] as string);
  if (!parsed) return null;
  const [first, second, third] = parsed.channels as [Token, Token, Token];
  const a = alphaOf(parsed.alpha);
  if (a === null) return null;
  if (name.startsWith('rgb')) {
    const r = fraction(first, 255);
    const g = fraction(second, 255);
    const b = fraction(third, 255);
    return r === null || g === null || b === null ? null : { r, g, b, a };
  }
  if (name.startsWith('hsl')) {
    const h = degrees(first);
    const s = second.unit === '%' || second.unit === 'none' ? fraction(second, 1) : null;
    const l = third.unit === '%' || third.unit === 'none' ? fraction(third, 1) : null;
    return h === null || s === null || l === null ? null : hslToRgb(h, s, l, a);
  }
  const l = first.unit === '%' || first.unit === '' || first.unit === 'none' ? fraction(first, 1) : null;
  const c = second.unit === '%' ? (second.value / 100) * 0.4 : second.unit === '' || second.unit === 'none' ? Math.max(0, second.value) : null;
  const h = degrees(third);
  if (l === null || c === null || h === null) return null;
  return oklchToRgb({ l, c, h: mod360(h), a });
}

/** The format a parsable string is written in; `null` if it does not parse. */
export function detectFormat(input: string): ColorFormat | null {
  const text = input.trim().toLowerCase();
  if (HEX.test(text)) return 'hex';
  if (!parseColor(text)) return null;
  if (text.startsWith('rgb')) return 'rgb';
  if (text.startsWith('hsl')) return 'hsl';
  return 'oklch';
}

// --- Formatting ---------------------------------------------------------------------------------

const round = (value: number, digits: number) => {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
};

const alphaSuffix = (a: number) => (a >= 1 ? '' : ` / ${round(a, 2)}`);

const hexPair = (channel: number) => Math.round(clamp01(channel) * 255).toString(16).padStart(2, '0');

/** Canonical string of an sRGB color: `#rrggbb`, `rgb(255 128 0)`, `hsl(24 100% 50%)`, `oklch(70.2% 0.187 48.5)`; alpha only when below 1. */
export function formatColor(rgba: Rgba, format: ColorFormat): string {
  const { r, g, b, a } = rgba;
  switch (format) {
    case 'hex':
      return `#${hexPair(r)}${hexPair(g)}${hexPair(b)}${a >= 1 ? '' : hexPair(a)}`;
    case 'rgb':
      return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)}${alphaSuffix(a)})`;
    case 'hsl': {
      const { h, s, l } = rgbToHsl(rgba);
      return `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%${alphaSuffix(a)})`;
    }
    case 'oklch': {
      const { l, c, h } = rgbToOklch(rgba);
      return `oklch(${round(l * 100, 1)}% ${round(c, 3)} ${round(h, 1)}${alphaSuffix(a)})`;
    }
  }
}

/** HSV → canonical string in one step: what the picker emits. */
export const formatHsva = (hsva: Hsva, format: ColorFormat): string => formatColor(hsvToRgb(hsva), format);

/** Parses any supported color straight into HSV; `null` if it does not parse. */
export function parseToHsva(input: string): Hsva | null {
  const rgba = parseColor(input);
  return rgba ? rgbToHsv(rgba) : null;
}
