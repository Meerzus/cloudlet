import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { codeToTokens } from 'shiki';
import { describe, expect, it } from 'vitest';
import { SHIKI_THEME } from '../../apps/site/src/lib/shiki-theme';
import {
  codeText,
  DIRECTIONS,
  EDGES,
  POSITIONS,
  positionOf,
  SIDES,
  sideEnabled,
  toasterCode,
  type Direction,
  type Position,
} from '../../apps/site/src/lib/toaster-settings';

/**
 * The model behind the Toaster's Preview: the controls reach every `position`, and the code they
 * make is what the page Toaster gets — coloured as Shiki colours it at build time and typed
 * against the package's own `ToasterProps`, as `check:docs` types every fence.
 */
const root = fileURLToPath(new URL('../../', import.meta.url));

/** Every setting the controls can make: Auto only with Center, Top and Bottom with every side. */
const settings: { position: Position; dir: Direction }[] = [];
for (const { value: edge } of EDGES) {
  for (const { value: side } of SIDES) {
    if (!sideEnabled(edge, side)) continue;
    for (const { value: dir } of DIRECTIONS) settings.push({ position: positionOf(edge, side), dir });
  }
}
const codes = [...new Set(settings.map((setting) => codeText(toasterCode(setting))))];

describe('Toaster preview settings', () => {
  it('reaches all seven positions; Auto only in the centre, whatever the width', () => {
    expect(new Set(settings.map((setting) => setting.position))).toEqual(new Set(POSITIONS));
    expect(settings).toHaveLength(POSITIONS.length * DIRECTIONS.length);
    expect(positionOf('auto', 'center')).toBe('auto');
    // A side left over from Top or Bottom does not leak into Auto.
    expect(positionOf('auto', 'left')).toBe('auto');
    expect(positionOf('auto', 'right')).toBe('auto');
    expect(positionOf('top', 'left')).toBe('top-left');
    expect(positionOf('bottom', 'center')).toBe('bottom-center');
    expect(SIDES.filter(({ value }) => sideEnabled('auto', value)).map(({ value }) => value)).toEqual(['center']);
    for (const edge of ['top', 'bottom'] as const) expect(SIDES.every(({ value }) => sideEnabled(edge, value))).toBe(true);
  });

  it('writes only the props that differ from the defaults', () => {
    expect(codeText(toasterCode({ position: 'auto', dir: 'ltr' }))).toBe('<Toaster />');
    expect(codeText(toasterCode({ position: 'top-left', dir: 'ltr' }))).toBe('<Toaster position="top-left" />');
    expect(codeText(toasterCode({ position: 'auto', dir: 'rtl' }))).toBe('<Toaster dir="rtl" />');
    expect(codeText(toasterCode({ position: 'bottom-right', dir: 'rtl' }))).toBe('<Toaster position="bottom-right" dir="rtl" />');
    expect(codes).toHaveLength(POSITIONS.length * DIRECTIONS.length);
  });

  it('colours every code as Shiki does in the documentation code blocks', async () => {
    for (const setting of settings) {
      const tokens = toasterCode(setting);
      const { tokens: lines } = await codeToTokens(codeText(tokens), { lang: 'tsx', theme: SHIKI_THEME });
      expect(lines).toHaveLength(1);
      expect(tokens.map(({ content, color }) => [content, color]), codeText(tokens)).toEqual(lines[0]!.map((token) => [token.content, token.color]));
    }
  });

  it('types every code against ToasterProps', async () => {
    // As check:docs types the fences: tsc on a scratch project with the package's own source.
    await mkdir(`${root}artifacts`, { recursive: true });
    const dir = await mkdtemp(`${root}artifacts/toaster-preview-`);
    const check = async (list: readonly string[]) => {
      const source = `import { Toaster } from '@cloudlet/toast';\n\nexport const codes = [\n${list.map((code) => `  ${code},`).join('\n')}\n];\n`;
      await writeFile(`${dir}/codes.tsx`, source);
      const config = {
        extends: `${root}tsconfig.base.json`,
        compilerOptions: { noEmit: true, types: ['react'], paths: { '@cloudlet/toast': [`${root}packages/toast/src/index.ts`] } },
        files: ['./codes.tsx'],
      };
      await writeFile(`${dir}/tsconfig.json`, JSON.stringify(config));
      const run = spawnSync(process.execPath, [`${root}node_modules/typescript/bin/tsc`, '--project', `${dir}/tsconfig.json`, '--pretty', 'false'], { encoding: 'utf8' });
      return { status: run.status, output: `${run.stdout}${run.stderr}`.trim() };
    };
    try {
      expect(await check(codes)).toEqual({ status: 0, output: '' });
      // The check bites: a value outside the union is an error.
      const wrong = await check(['<Toaster position="middle" />']);
      expect(wrong.status).not.toBe(0);
      expect(wrong.output).toMatch(/"middle"/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
