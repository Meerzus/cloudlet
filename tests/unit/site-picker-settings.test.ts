import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tableCode } from '../../apps/site/src/lib/code-table';
import { codeTable, codeTokens } from '../../apps/site/src/lib/code-tokens';
import {
  inFormat,
  paletteCode,
  paletteCodes,
  paletteColors,
  paletteKey,
  palettePreviewMarkdown,
  pickerCode,
  pickerCodes,
  pickerKey,
  pickerPreviewMarkdown,
  rewriteColors,
} from '../../apps/site/src/lib/picker-settings';
import { codeText } from '../../apps/site/src/lib/toaster-settings';

/**
 * The code of the color picker's and the color palette's Preview: what each combination of the
 * controls writes, that a default is left out, and that every code is a component that compiles
 * against the installed files.
 */
const root = fileURLToPath(new URL('../../', import.meta.url));

describe('site picker and palette preview code', () => {
  it('rewrites a color in a format, with opacity only when it is allowed', () => {
    expect(inFormat('#245cdb', 'hex', false)).toBe('#245cdb');
    expect(inFormat('#245cdb', 'rgb', false)).toBe('rgb(36 92 219)');
    expect(inFormat('rgb(36 92 219 / 0.5)', 'hex', true)).toBe('#245cdb80');
    expect(inFormat('rgb(36 92 219 / 0.5)', 'rgb', false)).toBe('rgb(36 92 219)');
    expect(inFormat('#245cdb80', 'hex', false)).toBe('#245cdb');
    expect(inFormat('var(--accent)', 'rgb', false)).toBe('var(--accent)');
  });

  it('rewrites a color from the one it came from, so a walk through the formats does not shift it', () => {
    // From its own string every switch would lose a little: hsl keeps whole percents.
    expect(inFormat(inFormat('#245cdb', 'hsl', false), 'hex', false)).toBe('#245bdb');
    const origins = new Map<string, string>();
    let colors: readonly string[] = ['#245cdb', '#f2b84b'];
    for (const format of ['hsl', 'rgb', 'oklch', 'hsl'] as const) colors = rewriteColors(colors, format, false, origins);
    expect(colors).toEqual(['hsl(222 72% 50%)', 'hsl(39 87% 62%)']);
    expect(rewriteColors(colors, 'hex', false, origins)).toEqual(['#245cdb', '#f2b84b']);
    // A color the reader changed has no origin: it is rewritten from itself, the others still from theirs.
    expect(rewriteColors(['#245cdb', '#123456'], 'rgb', false, origins)).toEqual(['rgb(36 92 219)', 'rgb(18 52 86)']);
    expect([...origins.keys()]).toEqual(['rgb(36 92 219)', 'rgb(18 52 86)']);
  });

  it('writes the picker with every default left out', () => {
    expect(pickerCode({ kind: 'swatch', format: 'hex', alpha: false })).toBe(
      [
        '"use client";',
        '',
        'import { useState } from "react";',
        'import { ColorPicker } from "@/components/ui/color-picker/color-picker";',
        '',
        'export function AccentColor() {',
        '  const [color, setColor] = useState("#245cdb");',
        '  return <ColorPicker color={color} onChange={setColor} />;',
        '}',
      ].join('\n'),
    );
    const panel = pickerCode({ kind: 'panel', format: 'oklch', alpha: true });
    expect(panel).toContain('import { ColorPickerPanel } from "@/components/ui/color-picker/color-picker";');
    expect(panel).toContain(`useState("${inFormat('#245cdb', 'oklch', false)}")`);
    expect(panel).toContain('<ColorPickerPanel color={color} onChange={setColor} defaultFormat="oklch" alpha />');
  });

  it('writes the palette: max only when it is not 4, and no more colors than max', () => {
    const plain = paletteCode({ max: '4', format: 'hex', alpha: false });
    expect(plain).toContain('<ColorPalette colors={colors} onChange={setColors} />');
    expect(plain).toContain('    "#245cdb",\n    "#f2b84b",\n    "#2f8f9d",\n');
    const two = paletteCode({ max: '2', format: 'rgb', alpha: true });
    expect(two).toContain('<ColorPalette colors={colors} onChange={setColors} max={2} defaultFormat="rgb" alpha />');
    expect(two).toContain('    "rgb(36 92 219)",\n    "rgb(242 184 75)",\n  ]);');
    expect(paletteColors('2')).toHaveLength(2);
    expect(paletteColors('3')).toHaveLength(3);
    expect(paletteColors('4')).toHaveLength(3);
  });

  it('has a code for every combination of the controls, and the table gives each back line for line', async () => {
    const picker = pickerCodes();
    const palette = paletteCodes();
    expect(Object.keys(picker)).toHaveLength(2 * 4 * 2);
    expect(Object.keys(palette)).toHaveLength(3 * 4 * 2);
    expect(new Set(Object.values(picker)).size).toBe(16);
    expect(new Set(Object.values(palette)).size).toBe(24);
    expect(picker[pickerKey({ kind: 'panel', format: 'hsl', alpha: true })]).toBe(pickerCode({ kind: 'panel', format: 'hsl', alpha: true }));
    expect(palette[paletteKey({ max: '3', format: 'hsl', alpha: false })]).toBe(paletteCode({ max: '3', format: 'hsl', alpha: false }));
    for (const codes of [picker, palette]) {
      const table = await codeTable(codes);
      // Shared lines are stored once.
      expect(table.lines.length).toBeLessThan(Object.keys(codes).length * 4);
      for (const [key, source] of Object.entries(codes)) {
        const lines = tableCode(table, key);
        expect(lines.map(codeText).join('\n'), key).toBe(source);
        expect(lines, key).toEqual(await codeTokens(source));
      }
    }
    expect(() => tableCode({ lines: [], codes: {} }, 'nope')).toThrow(/No code "nope"/u);
  });

  it('describes both Previews for agents: the address, a code, and what each control sets', () => {
    const picker = pickerPreviewMarkdown('https://cloudlet.dev/docs/components/color-picker#preview');
    expect(picker).toContain('Live preview at https://cloudlet.dev/docs/components/color-picker#preview:');
    expect(picker).toContain(`\`\`\`tsx\n${pickerCode({ kind: 'panel', format: 'oklch', alpha: true })}\n\`\`\``);
    expect(picker).toContain('- `defaultFormat`: `hex` (the default), `rgb`, `hsl`, `oklch`;');
    expect(picker).toContain('`ColorPicker` (the swatch that opens the picker) or `ColorPickerPanel` (the picker inline)');
    const palette = palettePreviewMarkdown('https://cloudlet.dev/docs/components/color-palette#preview');
    expect(palette).toContain('Live preview at https://cloudlet.dev/docs/components/color-palette#preview:');
    expect(palette).toContain(`\`\`\`tsx\n${paletteCode({ max: '3', format: 'oklch', alpha: true })}\n\`\`\``);
    expect(palette).toContain('- `max`: `2`, `3`, `4` (the default);');
    expect(palette).toContain('with every default the code is `<ColorPalette colors={colors} onChange={setColors} />`.');
    expect(paletteCode({ max: '4', format: 'hex', alpha: false })).toContain('<ColorPalette colors={colors} onChange={setColors} />');
  });

  it('types every code against the installed components', async () => {
    // tsc on a scratch project with the site's own settings and the files the CLI installs.
    await mkdir(`${root}artifacts`, { recursive: true });
    const dir = await mkdtemp(`${root}artifacts/picker-preview-`);
    const check = async (sources: readonly string[]) => {
      const files = sources.map((_, index) => `./code-${index}.tsx`);
      await Promise.all(sources.map((source, index) => writeFile(`${dir}/code-${index}.tsx`, `${source}\n`)));
      const config = {
        extends: `${root}apps/site/tsconfig.typecheck.json`,
        compilerOptions: { noEmit: true, incremental: false, plugins: [], paths: { '@/*': [`${root}apps/site/src/*`] } },
        include: [],
        files: [`${root}apps/site/next-env.d.ts`, ...files],
      };
      await writeFile(`${dir}/tsconfig.json`, JSON.stringify(config));
      const run = spawnSync(process.execPath, [`${root}node_modules/typescript/bin/tsc`, '--project', `${dir}/tsconfig.json`, '--pretty', 'false'], { encoding: 'utf8' });
      return { status: run.status, output: `${run.stdout}${run.stderr}`.trim() };
    };
    try {
      expect(await check([...Object.values(pickerCodes()), ...Object.values(paletteCodes())])).toEqual({ status: 0, output: '' });
      // The check bites: a format outside the union is an error.
      const wrong = await check([pickerCode({ kind: 'swatch', format: 'hex', alpha: false }).replace(' />', ' defaultFormat="cmyk" />')]);
      expect(wrong.status).not.toBe(0);
      expect(wrong.output).toMatch(/"cmyk"/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
