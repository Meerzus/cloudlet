import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { formatColor, oklchToRgb, parseColor, rgbToOklch, type Rgba } from '../../apps/site/src/components/ui/color-picker/color';
import { contrast, flatLut, flatOf, heroRamp, INK, LUT_SIZE, paletteRamp, rampLut, sampleRamp, sceneOf } from '../../apps/site/src/lib/picker-ramp';
import { colorFromSearch, paletteFromSearch, paletteParam, START_COLORS, START_GLOBAL, START_SCRIPT, startColor } from '../../apps/site/src/lib/picker-start';

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
  return { color: properties['--cp-color'], scene: attributes['data-cp-scene'], global: window[START_GLOBAL] };
}

const oklch = (color: string | Rgba) => rgbToOklch(typeof color === 'string' ? parseColor(color)! : color);
const lab = (color: string | Rgba) => {
  const { l, c, h } = oklch(color);
  return [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)] as const;
};
const distance = (p: string | Rgba, q: string | Rgba) => Math.hypot(...lab(p).map((value, index) => value - lab(q)[index]!));
const hueGap = (p: number, q: number) => Math.abs(((p - q + 540) % 360) - 180);

/** A grid over OKLCH — every 30° of hue, light to dark, greyish to vivid — plus the curated set and the extremes. */
const GRID: string[] = [...START_COLORS, '#ffffff', '#000000', '#808080', '#f7f7f7', '#0a0a0a', '#ffff00', '#0000ff', '#3d5a80'];
for (let h = 0; h < 360; h += 30) for (const l of [0.2, 0.35, 0.44, 0.46, 0.6, 0.75, 0.9]) for (const c of [0.05, 0.12, 0.2]) GRID.push(formatColor(oklchToRgb({ l, c, h, a: 1 }), 'hex'));

describe('color picker ramps (COLOR_PICKER §8.2)', () => {
  it('sets the scene by OKLCH lightness: dark under 0.45, light from there', () => {
    expect(heroRamp('#1b1f4a')?.scene).toBe('dark');
    expect(heroRamp('#000000')?.scene).toBe('dark');
    expect(heroRamp('#ff6a3d')?.scene).toBe('light');
    expect(heroRamp('#ffffff')?.scene).toBe('light');
    for (const color of GRID) expect(heroRamp(color)!.scene, color).toBe(sceneOf(oklch(color).l));
    // A dark scene reads the frame upside down: its pale paper becomes the deep end, under light ink.
    expect(heroRamp('#1b1f4a')?.invert).toBe(true);
    expect(heroRamp('#ff6a3d')?.invert).toBe(false);
  });

  it('takes any color the picker parses and ignores alpha; null for the rest', () => {
    expect(heroRamp('oklch(70% 0.19 48)')?.stops).toHaveLength(5);
    expect(heroRamp('rgb(255 106 61 / 0.3)')).toEqual(heroRamp('#ff6a3d'));
    expect(heroRamp('var(--accent)')).toBeNull();
  });

  it('the picked color holds the middle tones', () => {
    for (const color of GRID) {
      const { stops, scene } = heroRamp(color)!;
      const own = stops[scene === 'dark' ? 1 : 2];
      expect(own?.color, color).toBe(formatColor({ ...parseColor(color)!, a: 1 }, 'hex'));
      expect(own!.at, color).toBeGreaterThan(0.2);
      expect(own!.at, color).toBeLessThan(0.7);
      // Around its stop, every tone is nearest the picked color, or a stop indistinguishable from it (a near-white's lights).
      for (const t of [own!.at - 0.08, own!.at, own!.at + 0.08]) {
        const sample = sampleRamp(stops, t);
        const nearest = [...stops].sort((p, q) => distance(sample, p.color) - distance(sample, q.color))[0]!;
        expect(distance(nearest.color, own!.color), `${color} at ${t.toFixed(2)}: nearest ${nearest.color}`).toBeLessThan(0.06);
      }
    }
  });

  it('a dark color builds its lights from a neighbouring hue, never the complement', () => {
    for (const color of GRID) {
      const { scene, stops } = heroRamp(color)!;
      const { c, h } = oklch(color);
      if (scene !== 'dark' || c < 0.04) continue;
      for (let t = 0.6; t <= 1; t += 0.05) {
        const sample = oklch(sampleRamp(stops, t));
        if (sample.c < 0.02) continue;
        expect(hueGap(sample.h, h), `${color} at ${t.toFixed(2)}`).toBeLessThanOrEqual(45);
      }
    }
  });

  it('a light scene keeps the complement to the deepest shadow', () => {
    const { stops } = heroRamp('#ff6a3d')!;
    const { h } = oklch('#ff6a3d');
    expect(hueGap(oklch(stops[0]!.color).h, h)).toBeGreaterThan(150);
    for (let t = 0.25; t <= 1; t += 0.05) expect(hueGap(oklch(sampleRamp(stops, t)).h, h), t.toFixed(2)).toBeLessThanOrEqual(60);
  });

  it('a grey or near-white pick makes a grey ramp, not a borrowed hue', () => {
    for (const color of ['#808080', '#f7f7f7', '#ffffff', '#000000', '#0a0a0a']) {
      for (const stop of heroRamp(color)!.stops) expect(oklch(stop.color).c, `${color} ${stop.at}`).toBeLessThan(0.01);
    }
  });

  it('the scene ink reads over the calm end of the ramp: the lights of a light scene, the shadows of a dark one', () => {
    const ink = { light: parseColor(INK.light)!, dark: parseColor(INK.dark)! };
    for (const color of GRID) {
      const { scene, invert, stops } = heroRamp(color)!;
      // The shader lifts the frame's brightness under the copy to 0.8 at least (calmLuminance), read upside down in a dark
      // scene; grain moves it a few percent either way.
      const calm = invert ? [0, 0.12, 0.22] : [0.78, 0.9, 1];
      for (const t of calm) expect(contrast(ink[scene], sampleRamp(stops, t)), `${color} at ${t}`).toBeGreaterThanOrEqual(5);
      // The flat background before the material, and without WebGL 2.
      expect(contrast(ink[scene], parseColor(flatOf(color)!)!), `${color} flat`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('lays a palette out by lightness and builds its ends from the darkest and the lightest', () => {
    const colors = ['#f2b84b', '#1b1f4a', '#e8577e'];
    const { stops, scene, invert } = paletteRamp(colors)!;
    expect(scene).toBe('light');
    expect(invert).toBe(false);
    expect(stops.map((stop) => stop.color).slice(1, -1)).toEqual(['#1b1f4a', '#e8577e', '#f2b84b']);
    expect(stops[0]!.at).toBe(0);
    expect(stops.at(-1)!.at).toBe(1);
    expect(oklch(stops[0]!.color).l).toBeLessThan(oklch('#1b1f4a').l);
    expect(oklch(stops.at(-1)!.color).l).toBeGreaterThan(oklch('#f2b84b').l);
    for (let index = 1; index < stops.length; index += 1) expect(stops[index]!.at).toBeGreaterThan(stops[index - 1]!.at);
    // One color is the hero's ramp; the scene follows the first (the page's) color.
    expect(paletteRamp(['#ff6a3d'])).toEqual(heroRamp('#ff6a3d'));
    expect(paletteRamp(['#1b1f4a', '#f2b84b'])!.scene).toBe('dark');
    expect(paletteRamp(['nope'])).toBeNull();
  });

  it('any 2–4 colors give the palette ramp depth: lightness climbs, the darkest color sits in the shadows', () => {
    const grid: string[] = [];
    for (let r = 0; r < 256; r += 85) for (let g = 0; g < 256; g += 85) for (let b = 0; b < 256; b += 85) grid.push(`#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`);
    const l = (hex: string) => rgbToOklch(parseColor(hex)!).l;
    for (let size = 2; size <= 4; size++) {
      for (let start = 0; start < grid.length; start += 3) {
        const colors = Array.from({ length: size }, (_, index) => grid[(start + index * 17) % grid.length]!);
        const { stops } = paletteRamp(colors)!;
        const lightness = stops.map((stop) => l(stop.color));
        expect(lightness, colors.join()).toEqual([...lightness].sort((a, b) => a - b));
        expect(stops[1]!.color, colors.join()).toBe([...colors].sort((a, b) => l(a) - l(b))[0]);
        // The shadow end is darker than the darkest color (unless that is black already), the light end lighter than the lightest.
        expect(lightness[0]!, colors.join()).toBeLessThanOrEqual(Math.min(...colors.map(l)) * 0.5 + 0.001);
        expect(lightness.at(-1)!, colors.join()).toBeGreaterThanOrEqual(Math.max(...colors.map(l)) - 0.001);
      }
    }
  });

  it('turns a ramp into the lookup table the shader samples', () => {
    const { stops } = heroRamp('#ff6a3d')!;
    const lut = rampLut(stops);
    expect(lut).toHaveLength(LUT_SIZE * 4);
    const at = (index: number) => Array.from(lut.slice(index * 4, index * 4 + 4));
    expect(at(0)).toEqual([...Object.values(parseColor(stops[0]!.color)!).slice(0, 3).map((value) => Math.round(value * 255)), 255]);
    expect(at(LUT_SIZE - 1)).toEqual([...Object.values(parseColor(stops.at(-1)!.color)!).slice(0, 3).map((value) => Math.round(value * 255)), 255]);
    // The picked color sits at its stop (t = 0.6 → entry 153).
    expect(at(Math.round(0.6 * (LUT_SIZE - 1))).slice(0, 3)).toEqual([0xff, 0x6a, 0x3d]);
    expect(new Set(Array.from({ length: LUT_SIZE }, (_, index) => Array.from(flatLut('#123456').slice(index * 4, index * 4 + 4)).join()))).toEqual(new Set(['18,52,86,255']));
  });
});

describe('color picker landing start (COLOR_PICKER §8.2)', () => {
  it('reads ?c= as 3 or 6 hex digits and starts from a curated color otherwise', () => {
    expect(colorFromSearch('?c=FF5500')).toBe('#ff5500');
    expect(colorFromSearch('?x=1&c=f50')).toBe('#ff5500');
    expect(colorFromSearch('?c=%23ff5500')).toBeNull();
    expect(colorFromSearch('?c=ff55')).toBeNull();
    expect(colorFromSearch('')).toBeNull();
    expect(startColor('?c=0af', 0.5)).toBe('#00aaff');
    expect(startColor('', 0)).toBe(START_COLORS[0]);
    expect(startColor('', 0.99999)).toBe(START_COLORS.at(-1));
    expect(new Set(START_COLORS.map((color) => heroRamp(color)!.scene))).toEqual(new Set(['dark', 'light']));
  });

  it('reads ?c= as a palette: comma separated, the page color first, links with one color still work', () => {
    expect(paletteFromSearch('?c=ff6a3d')).toEqual(['#ff6a3d']);
    expect(paletteFromSearch('?c=ff6a3d,2f8f9d,f50')).toEqual(['#ff6a3d', '#2f8f9d', '#ff5500']);
    expect(paletteFromSearch('?c=ff6a3d%2C2f8f9d')).toEqual(['#ff6a3d', '#2f8f9d']);
    // Entries that are not colors drop out, at most four stay; without a first color there is no palette.
    expect(paletteFromSearch('?c=ff6a3d,nope,2f8f9d,111,222,333')).toEqual(['#ff6a3d', '#2f8f9d', '#111111', '#222222']);
    expect(paletteFromSearch('?c=nope,2f8f9d')).toBeNull();
    expect(colorFromSearch('?c=ff6a3d,2f8f9d')).toBe('#ff6a3d');
    expect(paletteParam(['#ff6a3d', '#2f8f9d'])).toBe('ff6a3d,2f8f9d');
    expect(runStartScript('?c=2f8f9d,ff6a3d').color).toBe('#2f8f9d');
    expect(runStartScript('?c=2f8f9d%2Cff6a3d').color).toBe('#2f8f9d');
  });

  it('the start script picks the same color and scene as the hero will', () => {
    const grid: string[] = [];
    for (let r = 0; r < 256; r += 51) for (let g = 0; g < 256; g += 51) for (let b = 0; b < 256; b += 51) grid.push(`#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`);
    for (const hex of [...grid, ...GRID]) {
      const run = runStartScript(`?c=${hex.slice(1)}`);
      expect(run.color, hex).toBe(hex);
      expect(run.global, hex).toBe(hex);
      expect(run.scene, hex).toBe(heroRamp(hex)!.scene);
    }
    expect(runStartScript('?c=F50').color).toBe('#ff5500');
    START_COLORS.forEach((_, index) => {
      const random = (index + 0.5) / START_COLORS.length;
      expect(runStartScript('?c=nope', random).color).toBe(startColor('', random));
    });
  });
});
