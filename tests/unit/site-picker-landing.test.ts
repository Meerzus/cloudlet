import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseColor, rgbToOklch } from '../../apps/site/src/components/ui/color-picker/color';
import { contrast, harmoniesOf, inkOn } from '../../apps/site/src/lib/harmonies';
import { PICKER_FAQ } from '../../apps/site/src/lib/picker-faq';
import { PICKER_GET_STARTED } from '../../apps/site/src/lib/picker-get-started';
import { COLOR_PICKER_COMMAND, SITE_URL } from '../../apps/site/src/lib/site';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const oklch = (hex: string) => rgbToOklch(parseColor(hex)!);
const fences = (markdown: string) => [...markdown.matchAll(/^```(?:tsx|ts)\n([\s\S]*?)\n```$/gm)].map((match) => match[1]);

describe('color picker landing (COLOR_PICKER §8.5)', () => {
  it('Get started shows the registry README example verbatim, which check:docs typechecks', () => {
    expect(fences(read(PICKER_GET_STARTED.source).toString('utf8'))).toContain(PICKER_GET_STARTED.code);
    expect(PICKER_GET_STARTED.command).toBe(COLOR_PICKER_COMMAND);
    expect(COLOR_PICKER_COMMAND).toBe(`npx shadcn@latest add ${SITE_URL}/r/color-picker.json`);
  });

  it('turns the harmonies in OKLCH: the hue moves, lightness stays, tints climb toward white', () => {
    const base = '#245cdb';
    const [complement, split, analogous, tints] = harmoniesOf(base);
    expect(complement!.colors[0]).toBe(base);
    expect(split!.colors).toHaveLength(3);
    expect(analogous!.colors[1]).toBe(base);
    const turned = oklch(complement!.colors[1]!);
    expect(Math.abs(turned.l - oklch(base).l)).toBeLessThan(0.01);
    expect(Math.abs(((turned.h - oklch(base).h + 360) % 360) - 180)).toBeLessThan(15);
    const lightness = tints!.colors.map((hex) => oklch(hex).l);
    expect(lightness).toEqual([...lightness].sort((a, b) => a - b));
  });

  it('prints poster text that reads on any paper', () => {
    for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) {
      const paper = `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
      expect(contrast(paper, inkOn(paper)), paper).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('ships a small 256 px grain tile (scripts/grain.mjs)', () => {
    const png = read('apps/site/public/picker/grain.png');
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([256, 256]);
    expect(statSync(new URL('../../apps/site/public/picker/grain.png', import.meta.url)).size).toBeLessThan(25_000);
  });

  it('answers the five questions of the spec', () => {
    expect(PICKER_FAQ.map((item) => item.id)).toEqual(['registry', 'oklch', 'eyedropper', 'overflow', 'labels']);
  });
});
