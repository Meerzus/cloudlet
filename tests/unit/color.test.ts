import { describe, expect, it } from 'vitest';
import { detectFormat, formatColor, formatHsva, hsvToRgb, oklchToRgb, parseColor, parseToHsva, rgbToHsv, rgbToOklch } from '../../apps/site/src/components/ui/color-picker/color';

const rgb = (r: number, g: number, b: number, a = 1) => ({ r: r / 255, g: g / 255, b: b / 255, a });

const near = (actual: number, expected: number, tolerance = 0.002) => Math.abs(actual - expected) <= tolerance;

/** Channel-by-channel comparison that ignores float noise. */
const expectRgb = (actual: ReturnType<typeof parseColor>, expected: ReturnType<typeof rgb>) => {
  expect(actual).not.toBeNull();
  for (const key of ['r', 'g', 'b', 'a'] as const) expect(actual![key], key).toBeCloseTo(expected[key], 9);
};

describe('parseColor', () => {
  it('reads hex in every length, case-insensitively, with whitespace around', () => {
    expect(parseColor('#f80')).toEqual(rgb(255, 136, 0));
    expect(parseColor('#F80C')).toEqual(rgb(255, 136, 0, 0.8));
    expect(parseColor('  #ff8800  ')).toEqual(rgb(255, 136, 0));
    expect(parseColor('#ff880080')).toEqual(rgb(255, 136, 0, 128 / 255));
  });

  it('reads rgb() in the modern and legacy syntax, numbers and percentages', () => {
    expect(parseColor('rgb(255 128 0)')).toEqual(rgb(255, 128, 0));
    expect(parseColor('rgb(255, 128, 0)')).toEqual(rgb(255, 128, 0));
    expect(parseColor('rgba(255, 128, 0, 0.5)')).toEqual(rgb(255, 128, 0, 0.5));
    expect(parseColor('rgb(255 128 0 / 50%)')).toEqual(rgb(255, 128, 0, 0.5));
    expect(parseColor('rgb(100% 50% 0%)')).toEqual(rgb(255, 127.5, 0));
    expect(parseColor('rgb(none 128 0)')).toEqual(rgb(0, 128, 0));
    expect(parseColor('rgb(300 -20 0)')).toEqual(rgb(255, 0, 0));
  });

  it('reads hsl() with and without units', () => {
    expectRgb(parseColor('hsl(24 100% 50%)'), rgb(255, 102, 0));
    expectRgb(parseColor('hsl(24deg, 100%, 50%)'), rgb(255, 102, 0));
    expectRgb(parseColor('hsla(0.5turn 100% 50% / 0.25)'), rgb(0, 255, 255, 0.25));
    expectRgb(parseColor('hsl(0 0% 100%)'), rgb(255, 255, 255));
  });

  it('reads oklch() with lightness as a percentage or a fraction and none as zero', () => {
    const fromPercent = parseColor('oklch(62.8% 0.258 29.2)');
    const fromFraction = parseColor('oklch(0.628 0.258 29.2deg)');
    expect(fromPercent).not.toBeNull();
    expect(near(fromPercent!.r, 1) && near(fromPercent!.g, 0, 0.01) && near(fromPercent!.b, 0, 0.01)).toBe(true);
    expect(fromFraction).toEqual(fromPercent);
    expectRgb(parseColor('oklch(100% none none)'), rgb(255, 255, 255));
    expectRgb(parseColor('oklch(0% 0 0)'), rgb(0, 0, 0));
  });

  it('brings an oklch color outside sRGB into gamut by losing chroma, keeping hue and lightness', () => {
    const vivid = parseColor('oklch(70% 0.4 145)');
    expect(vivid).not.toBeNull();
    const back = rgbToOklch(vivid!);
    expect(near(back.l, 0.7, 0.01)).toBe(true);
    expect(near(back.h, 145, 1)).toBe(true);
    expect(back.c).toBeLessThan(0.4);
    for (const channel of [vivid!.r, vivid!.g, vivid!.b]) expect(channel).toBeGreaterThanOrEqual(0);
    for (const channel of [vivid!.r, vivid!.g, vivid!.b]) expect(channel).toBeLessThanOrEqual(1);
  });

  it('rejects what it cannot show', () => {
    for (const input of ['', '#ff', '#ggg', 'var(--accent)', 'rebeccapurple', 'rgb(1 2)', 'rgb(1 2 3 4)', 'rgb(1 2 3 / )', 'hsl(24 1 0.5)', 'oklch(70% 0.1)', 'rgb(1 2 3) extra', 'color(display-p3 1 0 0)']) {
      expect(parseColor(input), input).toBeNull();
    }
  });
});

describe('detectFormat', () => {
  it('names the syntax of a parsable string', () => {
    expect(detectFormat('#abc')).toBe('hex');
    expect(detectFormat('RGB(1 2 3)')).toBe('rgb');
    expect(detectFormat('hsla(1, 2%, 3%, 0.5)')).toBe('hsl');
    expect(detectFormat('oklch(50% 0.1 20)')).toBe('oklch');
    expect(detectFormat('var(--x)')).toBeNull();
  });
});

describe('formatColor', () => {
  it('writes the canonical form of each format and adds alpha only below 1', () => {
    const orange = rgb(255, 128, 0);
    expect(formatColor(orange, 'hex')).toBe('#ff8000');
    expect(formatColor(orange, 'rgb')).toBe('rgb(255 128 0)');
    expect(formatColor(orange, 'hsl')).toBe('hsl(30 100% 50%)');
    expect(formatColor(orange, 'oklch')).toBe('oklch(73.2% 0.186 53)');
    const half = rgb(255, 128, 0, 0.5);
    expect(formatColor(half, 'hex')).toBe('#ff800080');
    expect(formatColor(half, 'rgb')).toBe('rgb(255 128 0 / 0.5)');
    expect(formatColor(half, 'hsl')).toBe('hsl(30 100% 50% / 0.5)');
    expect(formatColor(half, 'oklch')).toBe('oklch(73.2% 0.186 53 / 0.5)');
  });

  it('matches the OKLCH reference values of the sRGB primaries', () => {
    expect(formatColor(rgb(255, 0, 0), 'oklch')).toBe('oklch(62.8% 0.258 29.2)');
    expect(formatColor(rgb(0, 255, 0), 'oklch')).toBe('oklch(86.6% 0.295 142.5)');
    expect(formatColor(rgb(0, 0, 255), 'oklch')).toBe('oklch(45.2% 0.313 264.1)');
    expect(formatColor(rgb(255, 255, 255), 'oklch')).toBe('oklch(100% 0 0)');
    expect(formatColor(rgb(0, 0, 0), 'oklch')).toBe('oklch(0% 0 0)');
  });

  it('round-trips every format through parseColor within rounding (the oklch canon rounds L to 0.1% and C to 0.001, up to ≈ 4/255 at the gamut edge)', () => {
    for (const hex of ['#1c1c1e', '#d70015', '#336699', '#f4f1ea', '#00ff7f', '#8040c0']) {
      const source = parseColor(hex)!;
      for (const format of ['hex', 'rgb', 'hsl', 'oklch'] as const) {
        const back = parseColor(formatColor(source, format))!;
        expect(near(back.r, source.r, 0.02) && near(back.g, source.g, 0.02) && near(back.b, source.b, 0.02), `${hex} via ${format}`).toBe(true);
      }
    }
  });
});

describe('HSV', () => {
  it('converts both ways and keeps alpha', () => {
    expect(rgbToHsv(rgb(255, 0, 0, 0.5))).toEqual({ h: 0, s: 1, v: 1, a: 0.5 });
    expect(rgbToHsv(rgb(0, 255, 0))).toEqual({ h: 120, s: 1, v: 1, a: 1 });
    expect(rgbToHsv(rgb(0, 0, 255))).toEqual({ h: 240, s: 1, v: 1, a: 1 });
    expect(rgbToHsv(rgb(128, 128, 128))).toEqual({ h: 0, s: 0, v: 128 / 255, a: 1 });
    expect(hsvToRgb({ h: 360, s: 1, v: 1, a: 1 })).toEqual(rgb(255, 0, 0));
    expect(hsvToRgb({ h: -120, s: 1, v: 1, a: 1 })).toEqual(rgb(0, 0, 255));
    expect(formatHsva({ h: 210, s: 0.5, v: 0.6, a: 1 }, 'hex')).toBe('#4d7399');
    expect(parseToHsva('#4d7399')!.h).toBeCloseTo(210, 0);
  });

  it('clamps oklchToRgb lightness and reports greys without a hue', () => {
    expectRgb(oklchToRgb({ l: 1.5, c: 0, h: 0, a: 1 }), rgb(255, 255, 255));
    expect(rgbToOklch(rgb(120, 120, 120)).h).toBe(0);
    expect(rgbToOklch(rgb(120, 120, 120)).c).toBe(0);
  });
});
