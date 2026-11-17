import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { highlight } from '@/lib/highlight';
import { INSTALL_SNIPPETS, SNIPPET_KINDS, SNIPPET_START, snippetCode, usageLines } from '@/lib/install-code';
import { COMPONENTS, REGISTRY_ITEMS, REGISTRY_NAMESPACE, registryCommand, registryUrlCommand, SITE_URL } from '@/lib/site';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

interface Item {
  name: string;
  dependencies?: string[];
  registryDependencies?: string[];
  files: { path: string }[];
}
const registry = JSON.parse(read('registry/registry.json')) as { items: Item[] };
const itemOf = (name: string) => registry.items.find((entry) => entry.name === name)!;
const installation = read('apps/site/content/docs/en/installation.mdx');

/** The files an item brings, its registry dependencies' included (`@cloudlet/color-picker` is the `color-picker` item). */
function filesOf(name: string): string[] {
  const item = itemOf(name);
  const nested = (item.registryDependencies ?? []).map((dependency) => dependency.replace(`${REGISTRY_NAMESPACE}/`, ''));
  return [...item.files.map((file) => file.path), ...nested.flatMap(filesOf)];
}

/** Whether `source` exports `name` as a function, a const or in an `export { … }` list. */
function exportsName(source: string, name: string): boolean {
  return new RegExp(`export (?:async )?(?:function|const|class) ${name}\\b|export \\{[^}]*\\b${name}\\b[^}]*\\}`).test(source);
}

describe('kit install section', () => {
  it('installs every component of the kit by the namespace and by the address, as the docs write them', () => {
    expect(registry.items.map((entry) => entry.name)).toEqual([...REGISTRY_ITEMS]);
    expect(COMPONENTS.map((component) => component.id)).toEqual([...REGISTRY_ITEMS]);
    for (const item of REGISTRY_ITEMS) {
      expect(registryCommand(item)).toBe(`npx shadcn@latest add @cloudlet/${item}`);
      expect(registryUrlCommand(item)).toBe(`npx shadcn@latest add ${SITE_URL}/r/${item}.json`);
      expect(installation, item).toContain(`\`${item}\``);
    }
    expect(installation).toContain(registryCommand('color-picker'));
    expect(installation).toContain(registryUrlCommand('color-picker'));
    expect(installation).toContain(`${SITE_URL}/r/<item>.json`);
  });

  it('says what each item adds as the registry has it', () => {
    expect(itemOf('toaster').dependencies?.some((dependency) => dependency.startsWith('@cloudlet/toast@'))).toBe(true);
    expect(INSTALL_SNIPPETS.toaster.adds).toContain('@cloudlet/toast');
    expect(itemOf('color-picker').dependencies ?? []).toEqual([]);
    expect(INSTALL_SNIPPETS['color-picker'].adds).toMatch(/Nothing goes into package\.json/);
    expect(itemOf('color-palette').registryDependencies).toEqual(['@cloudlet/color-picker']);
    expect(INSTALL_SNIPPETS['color-palette'].adds).toMatch(/color picker/);
  });

  it('imports only what the item, or its npm dependency, exports', () => {
    for (const item of REGISTRY_ITEMS) {
      const files = filesOf(item);
      for (const { names, from } of INSTALL_SNIPPETS[item].imports) {
        let source: string;
        if (from === 'react') {
          expect(names, item).toEqual(['useState']);
          continue;
        } else if (from === '@cloudlet/toast') {
          expect(itemOf(item).dependencies?.some((dependency) => dependency.startsWith(`${from}@`)), item).toBe(true);
          source = read('packages/toast/src/index.ts');
        } else {
          // The CLI puts a `registry:ui` file under components/ui, keeping its folder under ui/ (the docs' tables).
          const rest = from.replace('@/components/ui/', '');
          const file = files.find((path) => path.endsWith(`/${rest}.tsx`) && (path.includes('/components/ui/') || path.startsWith('registry/cloudlet/')));
          expect(file, `${item}: ${from}`).toBeDefined();
          source = read(file!);
        }
        for (const name of names) expect(exportsName(source, name), `${item}: ${name} from ${from}`).toBe(true);
      }
    }
  });

  it('uses each imported name and the kinds the package knows', () => {
    const kinds = read('packages/toast/src/contracts/notifications.ts').match(/NotificationKind = ([^;]+);/)![1]!;
    for (const kind of SNIPPET_KINDS) expect(kinds).toContain(`'${kind}'`);
    for (const item of REGISTRY_ITEMS) {
      const body = usageLines(item, SNIPPET_START).join('\n');
      for (const { names } of INSTALL_SNIPPETS[item].imports) for (const name of names) expect(body, `${item}: ${name}`).toContain(name);
    }
  });

  it('copies what it shows, with the values set in it', () => {
    const values = { ...SNIPPET_START, title: 'Say "hi"', kind: 'error' as const, accent: 'oklch(70% 0.19 48)', colors: ['#000000'] };
    expect(snippetCode('toaster', values)).toContain('controller.show({ title: "Say \\"hi\\"", kind: "error" });');
    expect(snippetCode('color-picker', values)).toContain('useState("oklch(70% 0.19 48)")');
    expect(snippetCode('color-palette', values)).toContain('useState(["#000000"])');
    for (const item of REGISTRY_ITEMS) {
      const code = snippetCode(item, SNIPPET_START);
      expect(highlight(code).map((token) => token.text).join('')).toBe(code);
      expect(code.split('\n')[INSTALL_SNIPPETS[item].imports.length]).toBe('');
    }
  });
});
