import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { parseColor, rgbToOklch } from '../../apps/site/src/components/ui/color-picker/color';
import {
  colorFromSearch,
  hourOf,
  LANDSCAPE_FIELDS,
  landscapeFor,
  landscapeUniforms,
  START_COLORS,
  START_GLOBAL,
  START_SCRIPT,
  startColor,
} from '../../apps/site/src/lib/landscape';

/** Runs the inline start script against a fake <html> and returns what it left there. */
function runStartScript(search: string, random = 0) {
  const properties: Record<string, string> = {};
  const attributes: Record<string, string> = {};
  const window: Record<string, unknown> = {};
  const documentElement = {
    style: { setProperty: (name: string, value: string) => void (properties[name] = value) },
    setAttribute: (name: string, value: string) => void (attributes[name] = value),
  };
  runInNewContext(START_SCRIPT, { window, location: { search }, document: { documentElement }, Math: Object.assign(Object.create(Math), { random: () => random }) });
  return { color: properties['--cp-color'], hour: attributes['data-cp-hour'], global: window[START_GLOBAL] };
}

const lightness = (hex: string) => rgbToOklch(parseColor(hex)!).l;

describe('color picker landscape (COLOR_PICKER §8.2)', () => {
  it('sets the hour by lightness: dark night, warm middle dusk, light day, dark cold storm', () => {
    expect(landscapeFor('#ffffff')?.hour).toBe('day');
    expect(landscapeFor('#f2b84b')?.hour).toBe('day');
    expect(landscapeFor('#ff6a3d')?.hour).toBe('dusk');
    expect(landscapeFor('#e8577e')?.hour).toBe('dusk');
    expect(landscapeFor('#1b1f4a')?.hour).toBe('night');
    expect(landscapeFor('#000000')?.hour).toBe('night');
    expect(landscapeFor('#0f3d5c')?.hour).toBe('storm');
    // A middle cold blue is day, not dusk; a grey of the same lightness too.
    expect(landscapeFor('#245cdb')?.hour).toBe('day');
    expect(landscapeFor('#808080')?.hour).toBe('day');
  });

  it('takes any color the picker parses and ignores alpha; null for the rest', () => {
    expect(landscapeFor('oklch(70% 0.19 48)')?.hex).toMatch(/^#[\da-f]{6}$/);
    expect(landscapeFor('rgb(255 106 61 / 0.3)')).toEqual(landscapeFor('#ff6a3d'));
    expect(landscapeFor('var(--accent)')).toBeNull();
  });

  it('keeps the headline readable: dark ink only on a light sky', () => {
    for (const color of [...START_COLORS, '#ffffff', '#000000', '#808080', '#245cdb', '#ff0000', '#00ff00', '#0000ff', '#ffff00']) {
      const landscape = landscapeFor(color)!;
      const sky = lightness(landscape.colors.skyTop);
      if (landscape.ink === 'dark') expect(sky, color).toBeGreaterThanOrEqual(0.68);
      else expect(sky, color).toBeLessThanOrEqual(0.45);
    }
  });

  it('paints the disc with the picked color and the rest as hex fields', () => {
    const landscape = landscapeFor('#FF6A3D')!;
    expect(landscape.colors.disc).toBe('#ff6a3d');
    for (const field of LANDSCAPE_FIELDS) expect(landscape.colors[field], field).toMatch(/^#[\da-f]{6}$/);
    const uniforms = landscapeUniforms(landscape);
    expect(uniforms).toHaveLength(LANDSCAPE_FIELDS.length * 3);
    expect(Array.from(uniforms.slice(-3)).map((value) => Math.round(value * 255))).toEqual([0xff, 0x6a, 0x3d]);
  });

  it('turns stars on at night, rain in a storm and haze by day', () => {
    expect(landscapeFor('#1b1f4a')).toMatchObject({ stars: 1, rain: 0 });
    expect(landscapeFor('#0f3d5c')).toMatchObject({ stars: 0, rain: 1 });
    expect(landscapeFor('#7cc6fe')).toMatchObject({ stars: 0, haze: 1, rain: 0 });
  });

  it('reads ?c= as 3 or 6 hex digits and starts from a curated color otherwise', () => {
    expect(colorFromSearch('?c=FF5500')).toBe('#ff5500');
    expect(colorFromSearch('?x=1&c=f50')).toBe('#ff5500');
    expect(colorFromSearch('?c=%23ff5500')).toBeNull();
    expect(colorFromSearch('?c=ff55')).toBeNull();
    expect(colorFromSearch('')).toBeNull();
    expect(startColor('?c=0af', 0.5)).toBe('#00aaff');
    expect(startColor('', 0)).toBe(START_COLORS[0]);
    expect(startColor('', 0.99999)).toBe(START_COLORS.at(-1));
    expect(new Set(START_COLORS.map((color) => landscapeFor(color)!.hour))).toEqual(new Set(['day', 'dusk', 'night', 'storm']));
  });

  it('the start script picks the same color and hour as the hero will', () => {
    const grid: string[] = [];
    for (let r = 0; r < 256; r += 51) for (let g = 0; g < 256; g += 51) for (let b = 0; b < 256; b += 51) grid.push(`#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`);
    for (const hex of [...grid, ...START_COLORS]) {
      const run = runStartScript(`?c=${hex.slice(1)}`);
      expect(run.color, hex).toBe(hex);
      expect(run.global, hex).toBe(hex);
      expect(run.hour, hex).toBe(landscapeFor(hex)!.hour);
    }
    expect(runStartScript('?c=F50').color).toBe('#ff5500');
    START_COLORS.forEach((_, index) => {
      const random = (index + 0.5) / START_COLORS.length;
      expect(runStartScript('?c=nope', random).color).toBe(startColor('', random));
    });
  });

  it('hourOf matches landscapeFor on the OKLCH of the color', () => {
    const { l, c, h } = rgbToOklch(parseColor('#3b2a6b')!);
    expect(hourOf(l, c, h)).toBe(landscapeFor('#3b2a6b')!.hour);
  });
});
