import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../apps/site/src/components/docs/examples';
import { exampleMarkdown, exampleSource } from '../../apps/site/src/lib/example-source';

/**
 * The live examples of the docs: a file per example, the list that renders them, and the code the
 * page and the Markdown for agents show — the file itself, so the three cannot drift.
 */
const DIR = new URL('../../apps/site/src/components/docs/examples/', import.meta.url);
const CONTENT = new URL('../../apps/site/content/docs/en/', import.meta.url);

const files = readdirSync(DIR, { recursive: true, encoding: 'utf8' })
  .map((entry) => entry.replaceAll('\\', '/'))
  .filter((entry) => entry.endsWith('.tsx'))
  .map((entry) => entry.slice(0, -'.tsx'.length))
  .sort();

describe('site docs live examples', () => {
  it('lists exactly the example files', () => {
    expect(Object.keys(EXAMPLES).sort()).toEqual(files);
  });

  it('keeps every example a file a reader can copy: one exported component, the kit by the paths the CLI installs', () => {
    for (const name of files) {
      const { code, file } = exampleSource(name);
      expect(file, name).toBe(`${name.split('/')[1]}.tsx`);
      expect(code, name).toBe(readFileSync(new URL(`${name}.tsx`, DIR), 'utf8').trimEnd());
      expect(code.match(/^export /gmu), name).toHaveLength(1);
      expect(code, name).toMatch(/^export function [A-Z]\w*\(\) \{$/mu);
      const imports = [...code.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]!);
      expect(imports.length, name).toBeGreaterThan(0);
      for (const path of imports) expect(path, name).toMatch(/^(react|@\/components\/ui\/color-(picker\/color-picker|palette\/color-palette))$/u);
      expect(code, name).not.toContain("'");
    }
  });

  it('writes an example into the Markdown as the code of its file, under the file name', () => {
    const { code } = exampleSource('color-picker/panel');
    expect(exampleMarkdown('color-picker/panel')).toBe(`\`\`\`tsx title="panel.tsx"\n${code}\n\`\`\``);
  });

  it('fails on a name without a file', () => {
    expect(() => exampleSource('color-picker/nope')).toThrow(/Unknown example "color-picker\/nope"/u);
    expect(() => exampleSource('../site')).toThrow(/Unknown example/u);
    expect(() => exampleSource(undefined)).toThrow(/Unknown example/u);
  });

  it('uses every example on a page, and pages name only examples that exist', () => {
    const pages = readdirSync(CONTENT, { recursive: true, encoding: 'utf8' }).filter((entry) => entry.endsWith('.mdx'));
    const used = pages.flatMap((entry) => [...readFileSync(new URL(entry, CONTENT), 'utf8').matchAll(/<Example\b([^>]*)>/gu)].map((match) => /^ name="([^"]+)" \/$/u.exec(match[1]!)?.[1] ?? `malformed: ${match[0]}`));
    expect([...used].sort()).toEqual(files);
  });
});
