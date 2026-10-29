import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GET_STARTED } from '../../apps/site/src/lib/get-started';
import { highlight } from '../../apps/site/src/lib/highlight';
import { INSTALL_COMMAND, SHADCN_COMMAND, SITE_URL } from '../../apps/site/src/lib/site';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/** The bodies of the document's ```tsx / ```ts fences: exactly what check:docs compiles. */
function fences(markdown: string) {
  return [...markdown.matchAll(/^```(?:tsx|ts)\n([\s\S]*?)\n```$/gm)].map((match) => match[1]);
}

describe('site Get started', () => {
  it('shows snippets that are typechecked documentation examples, verbatim', () => {
    for (const tab of GET_STARTED) {
      expect(fences(read(tab.source)), `${tab.id} snippet must be a fenced example of ${tab.source}`).toContain(tab.code);
    }
  });

  it('uses the install commands of LANDING §9', () => {
    expect(GET_STARTED.map((tab) => tab.command)).toEqual([INSTALL_COMMAND, SHADCN_COMMAND]);
    expect(INSTALL_COMMAND).toBe('npm install @cloudlet/toast');
    expect(SHADCN_COMMAND).toBe(`npx shadcn@latest add ${SITE_URL}/r/toaster.json`);
    expect(existsSync(new URL('../../registry/r/toaster.json', import.meta.url))).toBe(true);
  });

  it('names the registry wrapper path the shadcn snippet imports', () => {
    const shadcn = GET_STARTED.find((tab) => tab.id === 'shadcn')!;
    expect(shadcn.code).toContain('from "@/components/ui/toaster"');
  });
});

describe('site highlight', () => {
  it('returns the source unchanged when the tokens are joined', () => {
    for (const tab of GET_STARTED) expect(highlight(tab.code).map((token) => token.text).join('')).toBe(tab.code);
  });

  it('tells keywords, strings, JSX tags and comments apart', () => {
    const tokens = highlight("import { x } from 'y';\n// note\nreturn <Toaster />;\nuseState<Controller | null>(null);\n<b>Notify</b>");
    const kinds = (text: string) => tokens.filter((token) => token.text.includes(text)).map((token) => token.kind);
    expect(kinds('import')).toEqual(['keyword']);
    expect(kinds("'y'")).toEqual(['string']);
    expect(kinds('// note')).toEqual(['comment']);
    expect(kinds('Toaster')).toEqual(['tag']);
    expect(kinds('Controller')).toEqual(['type']);
    expect(kinds('useState')).toEqual(['function']);
    expect(kinds('Notify')).toEqual(['plain']);
  });
});
