import { formatColor, parseColor } from '@/components/ui/color-picker/color';

/**
 * How a visit to the color picker landing starts (COLOR_PICKER §8.2): a random color from a curated
 * set, or the link's `?c=`; an inline script puts it on <html> before the page paints.
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
 * Runs before the page paints (inline, in the page): picks the start color like `startColor` and puts
 * it on <html> as `--cp-color`, so the server's markup shows the right flat background before React
 * hydrates. The theme, which picks the paint's scene, is on <html> already. Dependency-free ES5.
 */
export const START_SCRIPT = `(function(){try{var C=${JSON.stringify(START_COLORS)};var m=/[?&]c=([0-9a-fA-F]{3}|[0-9a-fA-F]{6})(?:,|%2C|&|$)/i.exec(location.search);var x=m?m[1].toLowerCase():C[Math.floor(Math.random()*C.length)].slice(1);if(x.length===3)x=x.charAt(0)+x.charAt(0)+x.charAt(1)+x.charAt(1)+x.charAt(2)+x.charAt(2);var hex='#'+x;document.documentElement.style.setProperty('--cp-color',hex);window.${START_GLOBAL}=hex}catch(e){}})()`;
