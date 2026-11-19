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

/** Every setting the controls can make, on a wide and on a narrow screen. */
const settings: { position: Position; dir: Direction }[] = [];
for (const wide of [true, false]) {
  for (const { value: edge } of EDGES) {
    for (const { value: side } of SIDES) {
      for (const { value: dir } of DIRECTIONS) settings.push({ position: positionOf(edge, side, wide), dir });
    }
  }
}
const codes = [...new Set(settings.map((setting) => codeText(toasterCode(setting))))];

describe('Toaster preview settings', () => {
  it('reaches all seven positions; auto only in the centre, its edge beside it follows the width', () => {
    expect(new Set(settings.map((setting) => setting.position))).toEqual(new Set(POSITIONS));
    expect(positionOf('auto', 'center', true)).toBe('auto');
    expect(positionOf('auto', 'center', false)).toBe('auto');
    expect(positionOf('auto', 'left', true)).toBe('top-left');
    expect(positionOf('auto', 'right', false)).toBe('bottom-right');
    expect(positionOf('bottom', 'center', true)).toBe('bottom-center');
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
