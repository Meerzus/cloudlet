import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KIT_CHAPTERS } from '@/components/kit/kit-shell';
import { KIT_FAQ } from '@/lib/kit-faq';
import { repoUrl, TESTED } from '@/lib/kit-principles';
import { COMPONENTS, GITHUB_URL } from '@/lib/site';
import { presetCss, presetStyle, THEME_PRESETS, THEME_TOKENS } from '@/lib/theme-presets';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

/** WCAG relative luminance of a `#rrggbb` color. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

describe('the theme presets of the kit landing', () => {
  it('start with the page’s own tokens and have unique ids', () => {
    expect(THEME_PRESETS[0]).toMatchObject({ tokens: null, font: null });
    expect(new Set(THEME_PRESETS.map((preset) => preset.id)).size).toBe(THEME_PRESETS.length);
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(2);
    expect(THEME_PRESETS.length).toBeLessThanOrEqual(3);
  });

  it('give every token a valid color in both themes, readable text and a visible focus ring', () => {
    for (const preset of THEME_PRESETS) {
      if (!preset.tokens) continue;
      for (const theme of ['light', 'dark'] as const) {
        const values = preset.tokens[theme];
        expect(Object.keys(values).sort()).toEqual([...THEME_TOKENS].sort());
        for (const token of THEME_TOKENS) expect(values[token], `${preset.id} ${theme} ${token}`).toMatch(/^#[0-9a-f]{6}$/);
        expect(contrast(values.foreground, values.background), `${preset.id} ${theme} text`).toBeGreaterThanOrEqual(7);
        expect(contrast(values.foreground, values.muted), `${preset.id} ${theme} text on muted`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(values['muted-foreground'], values.background), `${preset.id} ${theme} muted text`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(values.ring, values.background), `${preset.id} ${theme} ring`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('name a real font stack with a generic family last', () => {
    for (const preset of THEME_PRESETS) {
      if (preset.font === null) continue;
      expect(preset.font).toMatch(/,\s*(serif|sans-serif|monospace|system-ui)$/);
    }
  });

  it('go on the wrapper as variables for both themes, and show as an app’s stylesheet', () => {
    const paper = THEME_PRESETS.find((preset) => preset.tokens)!;
    const style = presetStyle(paper);
    for (const token of THEME_TOKENS) {
      expect(style[`--tp-light-${token}`]).toBe(paper.tokens!.light[token]);
      expect(style[`--tp-dark-${token}`]).toBe(paper.tokens!.dark[token]);
    }
    expect(style['--tp-font']).toBe(paper.font);
    expect(presetStyle(THEME_PRESETS[0]!)).toEqual({});
    expect(presetCss(paper, 'dark')).toContainEqual(['--background', paper.tokens!.dark.background]);
    expect(presetCss(paper, 'light').at(-1)).toEqual(['--font-sans', paper.font]);
    expect(presetCss(THEME_PRESETS[0]!, 'light')).toEqual([]);
  });

  it('cover the tokens the picker and the palette read, and their CSS maps each one for both themes', () => {
    const css = read('apps/site/src/components/ui/color-picker/color-picker.css') + read('apps/site/src/components/ui/color-palette/color-palette.css');
    for (const token of ['background', 'foreground', 'border', 'ring', 'muted']) {
      expect(css).toContain(`var(--${token}`);
      expect(THEME_TOKENS).toContain(token);
    }
    const kit = read('apps/site/src/components/kit/kit.css');
    for (const token of THEME_TOKENS) {
      expect(kit).toContain(`--${token}: var(--tp-light-${token});`);
      expect(kit).toContain(`--${token}: var(--tp-dark-${token});`);
    }
  });
});

describe('Tested, not promised', () => {
  it('links every claim to a file or folder that exists, on GitHub', () => {
    for (const claim of TESTED) {
      expect(claim.proof.length).toBeGreaterThan(0);
      for (const { path } of claim.proof) {
        const url = new URL(path, root);
        expect(existsSync(url), path).toBe(true);
        expect(statSync(url).isDirectory(), path).toBe(path.endsWith('/'));
        expect(repoUrl(path)).toBe(`${GITHUB_URL}/${path.endsWith('/') ? 'tree' : 'blob'}/main/${path.replace(/\/$/, '')}`);
      }
    }
  });

  it('rests on what the repository really runs', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/pull_request:\s+branches: \[main\]/);
    for (const script of ['npm run test:e2e', 'npm run test:consumers', 'npm run test:registry']) expect(ci).toContain(script);
    expect(ci).toContain('playwright install --with-deps chromium firefox webkit');
    for (const engine of ['chromium', 'firefox', 'webkit']) {
      expect(read('playwright.config.ts')).toContain(`name: '${engine}'`);
      expect(read('fixtures/integration/playwright.config.ts')).toContain(`name: '${engine}'`);
    }
    const registry = read('scripts/registry-check.mjs');
    expect(registry).toContain("import { chromium, firefox, webkit } from '@playwright/test'");
    for (const item of ['toaster', 'color-picker', 'color-palette']) expect(registry).toContain(`/r/${item}.json`);
    expect(registry).toContain('shadcn/dist/index.js');
    expect(read('registry/consumer/package.json')).toMatch(/"next": "/);
    expect(read('tests/e2e/accessibility.spec.ts')).toContain("import AxeBuilder from '@axe-core/playwright'");
    expect(read('apps/site/scripts/audit-color-picker.mjs')).toContain("import AxeBuilder from '@axe-core/playwright'");
    const voiceover = read('scripts/voiceover-safari-run.mjs');
    expect(voiceover).toContain('VoiceOver');
    for (const scenario of ['picker', 'palette']) expect(voiceover).toContain(`${scenario}: async`);
  });

  it('says nothing about size', () => {
    for (const claim of TESTED) expect(`${claim.title} ${claim.text}`).not.toMatch(/\bKB\b|\bkB\b|bytes|gzip|size/i);
  });
});

describe('the kit’s FAQ', () => {
  it('has five to seven questions, each with an answer and its own id', () => {
    expect(KIT_FAQ.length).toBeGreaterThanOrEqual(5);
    expect(KIT_FAQ.length).toBeLessThanOrEqual(7);
    expect(new Set(KIT_FAQ.map((item) => item.id)).size).toBe(KIT_FAQ.length);
    for (const item of KIT_FAQ) {
      expect(item.question).toMatch(/\?$/);
      expect(item.answer.trim().length).toBeGreaterThan(40);
    }
  });

  it('names every component of the kit, so it grows with the kit', () => {
    const what = KIT_FAQ.find((item) => item.id === 'what')!.answer;
    for (const component of COMPONENTS) expect(what).toContain(component.name);
  });
});

describe('the chapters of the kit landing', () => {
  it('put Principles and FAQ right after Install', () => {
    const ids = KIT_CHAPTERS.map((chapter) => chapter.id);
    expect(ids.slice(ids.indexOf('install'))).toEqual(['install', 'principles', 'faq']);
    const page = read('apps/site/src/app/(kit)/page.tsx');
    const order = ['<InstallSection />', '<PrinciplesSection />', '<KitFaq />', '<StarSection />'].map((tag) => page.indexOf(tag));
    expect(order.every((at, index) => at > 0 && (index === 0 || at > order[index - 1]!))).toBe(true);
  });
});
