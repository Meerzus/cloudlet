import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseColor, rgbToOklch } from '../../apps/site/src/components/ui/color-picker/color';
import { harmoniesOf } from '../../apps/site/src/lib/harmonies';
import { PICKER_FAQ } from '../../apps/site/src/lib/picker-faq';
import { PICKER_GET_STARTED } from '../../apps/site/src/lib/picker-get-started';
import { COLOR_PICKER_COMMAND, SITE_URL } from '../../apps/site/src/lib/site';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const oklch = (hex: string) => rgbToOklch(parseColor(hex)!);
const fences = (markdown: string) => [...markdown.matchAll(/^```(?:tsx|ts)\n([\s\S]*?)\n```$/gm)].map((match) => match[1]);

describe('color picker landing (COLOR_PICKER §8.1, §8.5)', () => {
  it('Get started shows the registry README example verbatim, which check:docs typechecks', () => {
    expect(fences(read(PICKER_GET_STARTED.source).toString('utf8'))).toContain(PICKER_GET_STARTED.code);
    expect(PICKER_GET_STARTED.command).toBe(COLOR_PICKER_COMMAND);
    expect(COLOR_PICKER_COMMAND).toBe(`npx shadcn@latest add ${SITE_URL}/r/color-picker.json`);
  });

  it('turns the harmonies in OKLCH, the base first: the hue moves, lightness stays, tints climb toward white', () => {
    const base = '#245cdb';
    const harmonies = harmoniesOf(base);
    expect(harmonies.map((harmony) => harmony.colors.length)).toEqual([2, 3, 3, 4]);
    // A hint fills the palette, and the palette's first color is the page's: every harmony starts from it.
    for (const harmony of harmonies) expect(harmony.colors[0], harmony.id).toBe(base);
    const turned = oklch(harmonies[0]!.colors[1]!);
    expect(Math.abs(turned.l - oklch(base).l)).toBeLessThan(0.01);
    expect(Math.abs(((turned.h - oklch(base).h + 360) % 360) - 180)).toBeLessThan(15);
    const lightness = harmonies[3]!.colors.map((hex) => oklch(hex).l);
    expect(lightness).toEqual([...lightness].sort((a, b) => a - b));
  });

  it('the posters, their glyphs and their grain are gone with Combinations', () => {
    for (const path of ['apps/site/src/components/picker/combinations.tsx', 'apps/site/src/components/picker/glyphs.tsx', 'apps/site/public/picker/grain.png', 'apps/site/scripts/grain.mjs']) {
      expect(existsSync(new URL(`../../${path}`, import.meta.url)), path).toBe(false);
    }
    const page = read('apps/site/src/app/color-picker/page.tsx').toString('utf8');
    expect(page).not.toMatch(/combinations/i);
    expect([...page.matchAll(/\{ id: '([a-z-]+)'/g)].map((match) => match[1])).toEqual(['hero', 'palette', 'keyboards', 'get-started', 'faq']);
  });

  it('answers the five questions of the spec', () => {
    expect(PICKER_FAQ.map((item) => item.id)).toEqual(['registry', 'oklch', 'eyedropper', 'overflow', 'labels']);
  });
});
