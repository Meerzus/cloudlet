import { formatColor, oklchToRgb, parseColor, rgbToOklch, type Rgba } from '@/components/ui/color-picker/color';

/**
 * The color picker landing's landscape (COLOR_PICKER §8.2): one function turns the picked color into
 * the hour and the five or six derived fields of the scene, in OKLCH. The hero's shader gets them as
 * uniforms and the Combinations scene reads the same palette.
 */

/** Lightness of the picked color sets the hour; a dark, greyish steel blue is the rare storm. */
export type Hour = 'night' | 'dusk' | 'day' | 'storm';

/** The scene's fields, in the shader's uniform order (`LANDSCAPE_FIELDS`). */
export interface LandscapeColors {
  /** Top of the sky, where the headline sits. */
  readonly skyTop: string;
  /** The sky at the horizon. */
  readonly horizon: string;
  readonly farHills: string;
  readonly nearHills: string;
  readonly cloud: string;
  readonly water: string;
  /** The airbrushed glow around the disc. */
  readonly halo: string;
  /** The complement: stars, lightning, sparkles. */
  readonly accent: string;
  /** The disc itself: the picked color. */
  readonly disc: string;
}

export interface Landscape {
  readonly hour: Hour;
  /** Headline and subtitle over the sky: dark ink by day, light ink otherwise. */
  readonly ink: 'dark' | 'light';
  /** The picked color as `#rrggbb`. */
  readonly hex: string;
  readonly colors: LandscapeColors;
  /** Effects in [0, 1]: four-point stars, haze at the horizon, rain and lightning. */
  readonly stars: number;
  readonly haze: number;
  readonly rain: number;
}

export const LANDSCAPE_FIELDS = ['skyTop', 'horizon', 'farHills', 'nearHills', 'cloud', 'water', 'halo', 'accent', 'disc'] as const satisfies readonly (keyof LandscapeColors)[];

/**
 * Curated start colors: a random one greets each visit (§8.2). Spread over the hours so the
 * landscape shows its range; the first is the server's color before the start script runs.
 */
export const START_COLORS = [
  '#ff6a3d',
  '#f2b84b',
  '#7cc6fe',
  '#9be7a8',
  '#e8577e',
  '#c96bdc',
  '#2e8b57',
  '#f7d6e0',
  '#1b1f4a',
  '#3b2a6b',
  '#0f3d5c',
] as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const mod360 = (degrees: number) => ((degrees % 360) + 360) % 360;
const isWarm = (h: number) => h <= 95 || h >= 330;
/** Steel blue: a storm, not a night, when it is also a little grey and not too dark. */
const isSteel = (h: number) => h >= 200 && h <= 255;

/**
 * The hour of a color given its OKLCH lightness, chroma and hue. `HOUR_SCRIPT` repeats this rule
 * in ES5 for the start script; tests/unit/site-landscape.test.ts keeps the two equal.
 */
export function hourOf(l: number, c: number, h: number): Hour {
  if (l >= 0.28 && l < 0.42 && c >= 0.03 && c <= 0.12 && isSteel(h)) return 'storm';
  if (l < 0.45) return 'night';
  if (l < 0.72 && c >= 0.04 && isWarm(h)) return 'dusk';
  return 'day';
}

const oklch = (l: number, c: number, h: number) => formatColor(oklchToRgb({ l: clamp(l, 0, 1), c: Math.max(0, c), h: mod360(h), a: 1 }), 'hex');

/** The landscape for any CSS color the picker parses; null for anything else. */
export function landscapeFor(input: string): Landscape | null {
  const rgba = parseColor(input);
  if (!rgba) return null;
  const opaque: Rgba = { ...rgba, a: 1 };
  const { l: L, c: C, h: H } = rgbToOklch(opaque);
  const hour = hourOf(L, C, H);
  // Riso inks: chroma is capped so a neon pick still prints as a calm field.
  const c = Math.min(C, 0.16);
  const disc = formatColor(opaque, 'hex');
  const accent = oklch(0.78, Math.max(c, 0.08), H + 180);
  let colors: Omit<LandscapeColors, 'disc' | 'accent'>;
  let fx: Pick<Landscape, 'stars' | 'haze' | 'rain'>;
  switch (hour) {
    case 'day': {
      const top = clamp(L + 0.04, 0.7, 0.86);
      colors = {
        skyTop: oklch(top, c * 0.7, H),
        horizon: oklch(Math.min(0.96, top + 0.11), c * 0.35, H + 10),
        farHills: oklch(top - 0.13, c * 0.6, H + 25),
        nearHills: oklch(top - 0.28, c * 0.8, H + 45),
        cloud: oklch(0.985, 0.012, H),
        water: oklch(top - 0.07, c * 0.6, H - 10),
        halo: oklch(0.97, c * 0.35, H + 10),
      };
      fx = { stars: 0, haze: 1, rain: 0 };
      break;
    }
    case 'dusk':
      colors = {
        skyTop: oklch(0.36, c * 0.55, H - 60),
        horizon: oklch(clamp(L + 0.08, 0.66, 0.78), c, H + 8),
        farHills: oklch(0.38, c * 0.5, H - 35),
        nearHills: oklch(0.25, c * 0.4, H - 70),
        cloud: oklch(0.8, c * 0.5, H + 12),
        water: oklch(0.42, c * 0.5, H - 45),
        halo: oklch(0.92, c * 0.6, H + 15),
      };
      fx = { stars: 0.3, haze: 0.45, rain: 0 };
      break;
    case 'night': {
      const n = Math.min(c, 0.08);
      colors = {
        skyTop: oklch(clamp(L * 0.45, 0.1, 0.18), n * 0.8, H),
        // A moonlit horizon, so the hills stand out against it.
        horizon: oklch(clamp(L * 0.9, 0.24, 0.34), n, H + 10),
        farHills: oklch(clamp(L * 0.5, 0.12, 0.2), n * 0.7, H + 20),
        nearHills: oklch(clamp(L * 0.3, 0.07, 0.12), n * 0.6, H + 30),
        cloud: oklch(0.34, n * 0.5, H),
        water: oklch(clamp(L * 0.55, 0.14, 0.22), n * 0.8, H),
        halo: oklch(0.9, 0.05, H + 30),
      };
      fx = { stars: 1, haze: 0, rain: 0 };
      break;
    }
    case 'storm': {
      const n = Math.min(c, 0.05);
      colors = {
        skyTop: oklch(clamp(L * 0.55, 0.14, 0.2), n * 0.6, H),
        horizon: oklch(clamp(L * 0.9, 0.24, 0.34), n * 0.5, H),
        farHills: oklch(0.2, n * 0.5, H + 15),
        nearHills: oklch(0.12, n * 0.4, H + 25),
        cloud: oklch(0.3, n * 0.4, H),
        water: oklch(0.2, n * 0.6, H),
        halo: oklch(0.62, 0.03, H),
      };
      fx = { stars: 0, haze: 0.2, rain: 1 };
      break;
    }
  }
  return { hour, ink: hour === 'day' ? 'dark' : 'light', hex: disc, colors: { ...colors, accent, disc }, ...fx };
}

/**
 * The flat sky the hero shows before the landscape draws, and for good without WebGL 2 (§8.3):
 * the picked color mixed in OKLCH toward black, or toward white by day. picker.css writes the
 * same `color-mix(in oklch, …)` per `data-cp-hour`; the landscape bleeds out of it on load.
 */
export const FLAT_SKY: Record<Hour, { readonly amount: number; readonly toward: 'black' | 'white' }> = {
  day: { amount: 0.6, toward: 'white' },
  dusk: { amount: 0.55, toward: 'black' },
  night: { amount: 0.55, toward: 'black' },
  storm: { amount: 0.55, toward: 'black' },
};

export function flatSky(landscape: Landscape): string {
  const { l, c, h } = rgbToOklch(parseColor(landscape.hex)!);
  const { amount, toward } = FLAT_SKY[landscape.hour];
  return oklch(l * amount + (toward === 'white' ? 1 - amount : 0), c * amount, h);
}

/** The fields as sRGB triplets in [0, 1], in `LANDSCAPE_FIELDS` order: the shader's `vec3` array. */
export function landscapeUniforms(landscape: Landscape): Float32Array {
  const out = new Float32Array(LANDSCAPE_FIELDS.length * 3);
  LANDSCAPE_FIELDS.forEach((field, index) => {
    const rgb = parseColor(landscape.colors[field]) ?? { r: 0, g: 0, b: 0 };
    out.set([rgb.r, rgb.g, rgb.b], index * 3);
  });
  return out;
}

/** `?c=ff5500` (3 or 6 hex digits, no #) as `#rrggbb`; null when absent or not a color. */
export function colorFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get('c');
  if (!value || !/^(?:[\da-f]{3}|[\da-f]{6})$/iu.test(value)) return null;
  return formatColor(parseColor(`#${value}`)!, 'hex');
}

/** The color a visit starts with: the link's `?c=`, otherwise a random curated one. */
export function startColor(search: string, random: number): string {
  return colorFromSearch(search) ?? START_COLORS[Math.floor(clamp(random, 0, 0.9999) * START_COLORS.length)]!;
}

/** Global the start script leaves for the hero: the color it painted the first frame with. */
export const START_GLOBAL = '__cloudletColor';

/**
 * Runs before the hero paints (inline, in the page): picks the start color like `startColor`, puts
 * it on <html> as `--cp-color` with `data-cp-hour` (and `data-cp-top`: the header sits on the hero),
 * so the server's markup shows the right sky and ink before React hydrates. Dependency-free ES5; the hour rule repeats `hourOf`.
 */
export const START_SCRIPT = `(function(){try{var C=${JSON.stringify(START_COLORS)};var m=/[?&]c=([0-9a-fA-F]{3}|[0-9a-fA-F]{6})(?:&|$)/.exec(location.search);var x=m?m[1].toLowerCase():C[Math.floor(Math.random()*C.length)].slice(1);if(x.length===3)x=x.charAt(0)+x.charAt(0)+x.charAt(1)+x.charAt(1)+x.charAt(2)+x.charAt(2);var hex='#'+x;var r=document.documentElement;r.style.setProperty('--cp-color',hex);r.setAttribute('data-cp-hour',(${hourScript()})(hex));r.setAttribute('data-cp-top','');window.${START_GLOBAL}=hex}catch(e){}})()`;

/** ES5 copy of `hourOf` over a `#rrggbb` string, for START_SCRIPT. */
function hourScript(): string {
  return `function(h){function f(i){var v=parseInt(h.substr(i,2),16)/255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4)}var R=f(1),G=f(3),B=f(5);var l=Math.cbrt(0.4122214708*R+0.5363325363*G+0.0514459929*B),m=Math.cbrt(0.2119034982*R+0.6806995451*G+0.1073969566*B),s=Math.cbrt(0.0883024619*R+0.2817188376*G+0.6299787005*B);var L=0.2104542553*l+0.793617785*m-0.0040720468*s,A=1.9779984951*l-2.428592205*m+0.4505937099*s,Bb=0.0259040371*l+0.7827717662*m-0.808675766*s;var c=Math.sqrt(A*A+Bb*Bb);var H=c<1e-4?0:((Math.atan2(Bb,A)*180/Math.PI)%360+360)%360;if(c<1e-4)c=0;var warm=H<=95||H>=330,steel=H>=200&&H<=255;if(L>=0.28&&L<0.42&&c>=0.03&&c<=0.12&&steel)return'storm';if(L<0.45)return'night';if(L<0.72&&c>=0.04&&warm)return'dusk';return'day'}`;
}
