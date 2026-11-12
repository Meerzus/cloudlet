import { formatColor, parseColor } from '@/components/ui/color-picker/color';
import { DARK_BELOW } from './picker-ramp';

/**
 * How a visit to the color picker landing starts (COLOR_PICKER §8.2): a random color from a curated
 * set, or the link's `?c=`; an inline script puts it and its scene on <html> before the hero paints.
 */

/** Curated start colors: warm and cold, light and dark, so the material shows its range. The first is the server's color. */
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

/** Most colors a palette — and so `?c=` — holds (COLOR_PALETTE §2: `max` defaults to 4). */
export const PALETTE_MAX = 4;

const HEX_DIGITS = /^(?:[\da-f]{3}|[\da-f]{6})$/iu;

/**
 * `?c=ff5500,2f8f9d` (3 or 6 hex digits each, no #, at most PALETTE_MAX) as `#rrggbb` strings, the
 * page color first; a link from before the palette carries one color. Null when absent or when the
 * first is not a color (the start script reads the same first entry); later entries that are not
 * colors are dropped.
 */
export function paletteFromSearch(search: string): string[] | null {
  const value = new URLSearchParams(search).get('c');
  const [first, ...rest] = value?.split(',') ?? [];
  if (!first || !HEX_DIGITS.test(first)) return null;
  return [first, ...rest.filter((entry) => HEX_DIGITS.test(entry))].slice(0, PALETTE_MAX).map((entry) => formatColor(parseColor(`#${entry}`)!, 'hex'));
}

/** The page color of `?c=`: its first entry. */
export const colorFromSearch = (search: string): string | null => paletteFromSearch(search)?.[0] ?? null;

/** `#rrggbb` colors as the value of `?c=`: their digits, comma separated. */
export const paletteParam = (colors: readonly string[]): string => colors.map((hex) => hex.slice(1)).join(',');

/** The color a visit starts with: the link's `?c=`, otherwise a random curated one. */
export function startColor(search: string, random: number): string {
  return colorFromSearch(search) ?? START_COLORS[Math.floor(clamp(random, 0, 0.9999) * START_COLORS.length)]!;
}

/** Global the start script leaves for the hero: the color it painted the first frame with. */
export const START_GLOBAL = '__cloudletColor';

/**
 * Runs before the hero paints (inline, in the page): picks the start color like `startColor`, puts
 * it on <html> as `--cp-color` with `data-cp-scene` (and `data-cp-top`: the header sits on the hero),
 * so the server's markup shows the right flat background and ink before React hydrates.
 * Dependency-free ES5; the scene rule repeats `sceneOf` over OKLab lightness.
 */
export const START_SCRIPT = `(function(){try{var C=${JSON.stringify(START_COLORS)};var m=/[?&]c=([0-9a-fA-F]{3}|[0-9a-fA-F]{6})(?:,|%2C|&|$)/i.exec(location.search);var x=m?m[1].toLowerCase():C[Math.floor(Math.random()*C.length)].slice(1);if(x.length===3)x=x.charAt(0)+x.charAt(0)+x.charAt(1)+x.charAt(1)+x.charAt(2)+x.charAt(2);var hex='#'+x;var r=document.documentElement;r.style.setProperty('--cp-color',hex);r.setAttribute('data-cp-scene',(${sceneScript()})(hex));r.setAttribute('data-cp-top','');window.${START_GLOBAL}=hex}catch(e){}})()`;

/** ES5 copy of `sceneOf(OKLCH lightness)` over a `#rrggbb` string, for START_SCRIPT. */
function sceneScript(): string {
  return `function(h){function f(i){var v=parseInt(h.substr(i,2),16)/255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4)}var R=f(1),G=f(3),B=f(5);var l=Math.cbrt(0.4122214708*R+0.5363325363*G+0.0514459929*B),m=Math.cbrt(0.2119034982*R+0.6806995451*G+0.1073969566*B),s=Math.cbrt(0.0883024619*R+0.2817188376*G+0.6299787005*B);return 0.2104542553*l+0.793617785*m-0.0040720468*s<${DARK_BELOW}?'dark':'light'}`;
}
