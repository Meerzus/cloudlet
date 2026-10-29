import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createStringifier } from 'fumadocs-core/mdx-plugins/stringifier';
import { findDemo } from '../../apps/site/src/lib/demos';
import { DEMO_META, DEMO_NOTE, remarkDemoNote } from '../../apps/site/src/lib/remark-demo-note';

/**
 * Runnable documentation examples: a fence with `demo="<id>"` gets Run, which
 * calls that entry of the demo catalog, so the code the reader sees must be the entry's
 * snippet, character for character. site-demos.test.ts keeps each snippet equal to its run.
 */
const CONTENT = new URL('../../apps/site/content/docs/en/', import.meta.url);

interface DemoFence {
  readonly at: string;
  readonly id: string;
  readonly code: string;
}

/** Every `demo=` fence of a document, with its file:line. */
function demoFences(markdown: string, file: string): DemoFence[] {
  const lines = markdown.split('\n');
  const fences: DemoFence[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const start = /^ {0,3}(`{3,}|~{3,})\S*(.*)$/u.exec(lines[index]!);
    if (!start) continue;
    const marker = start[1]!;
    const end = lines.findIndex((line, next) => next > index && line.trim() === marker);
    expect(end, `${file}:${index + 1}: unclosed fence`).toBeGreaterThan(index);
    const id = DEMO_META.exec(start[2]!)?.[1];
    if (id) fences.push({ at: `${file}:${index + 1}`, id, code: lines.slice(index + 1, end).join('\n') });
    index = end;
  }
  return fences;
}

/**
 * `<Demos>` … `</Demos>` groups fences into one demo block: inside, only `demo=`
 * fences and blank lines, at least two of them. Problems carry their file:line.
 */
function groupProblems(markdown: string, file: string): string[] {
  const lines = markdown.split('\n');
  const problems: string[] = [];
  let group: { at: string; fences: number } | undefined;
  let fence: string | undefined;
  for (const [index, line] of lines.entries()) {
    const at = `${file}:${index + 1}`;
    if (fence) {
      if (line.trim() === fence) fence = undefined;
      continue;
    }
    const opener = /^ {0,3}(`{3,}|~{3,})\S*(.*)$/u.exec(line);
    if (opener) {
      fence = opener[1]!;
      if (group) {
        if (DEMO_META.test(opener[2]!)) group.fences += 1;
        else problems.push(`${at}: a fence without demo= inside <Demos>`);
      }
      continue;
    }
    if (line.trim() === '<Demos>') {
      if (group) problems.push(`${at}: <Demos> inside <Demos>`);
      group = { at, fences: 0 };
    } else if (line.trim() === '</Demos>') {
      if (!group) problems.push(`${at}: </Demos> without <Demos>`);
      else if (group.fences < 2) problems.push(`${group.at}: <Demos> needs at least two demo fences`);
      group = undefined;
    } else if (group && line.trim() !== '') {
      problems.push(`${at}: only demo fences and blank lines belong inside <Demos>`);
    }
  }
  if (group) problems.push(`${group.at}: <Demos> is not closed`);
  return problems;
}

function allDemoFences() {
  return readdirSync(CONTENT, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.mdx'))
    .sort()
    .flatMap((entry) => demoFences(readFileSync(new URL(entry, CONTENT), 'utf8'), `apps/site/content/docs/en/${entry.replaceAll('\\', '/')}`));
}

/** The mismatches, one line each, so a failure names every block that drifted. */
function problems(fences: readonly DemoFence[]) {
  return fences.flatMap(({ at, id, code }) => {
    const demo = findDemo(id);
    if (!demo) return [`${at}: demo "${id}" is not in the catalog (apps/site/src/lib/demos.tsx)`];
    return code === demo.snippet ? [] : [`${at}: code differs from the snippet of demo "${id}"`];
  });
}

describe('site docs runnable examples', () => {
  const fences = allDemoFences();

  it('has runnable examples on the pages', () => {
    expect(fences.map((fence) => fence.at)).toContainEqual(expect.stringContaining('quick-start.mdx'));
  });

  it('shows the catalog snippet of every demo fence verbatim', () => {
    expect(problems(fences)).toEqual([]);
  });

  it('groups only demo fences inside <Demos>, at least two', () => {
    const pages = readdirSync(CONTENT, { recursive: true, encoding: 'utf8' }).filter((entry) => entry.endsWith('.mdx')).sort();
    const problems = pages.flatMap((entry) => groupProblems(readFileSync(new URL(entry, CONTENT), 'utf8'), entry));
    expect(problems).toEqual([]);
    const grouped = pages.filter((entry) => readFileSync(new URL(entry, CONTENT), 'utf8').includes('<Demos>'));
    expect(grouped).toEqual(['notifications.mdx', 'positioning.mdx']);
  });

  it('names the file and line of a <Demos> that holds prose, one fence or no end', () => {
    const page = [
      '<Demos>',
      '',
      '```tsx demo="success"',
      'a();',
      '```',
      '',
      'Some prose.',
      '',
      '```tsx title="x.ts"',
      'b();',
      '```',
      '',
      '</Demos>',
      '<Demos>',
      '```tsx demo="info"',
      'c();',
      '```',
      '</Demos>',
      '<Demos>',
    ].join('\n');
    expect(groupProblems(page, 'page.mdx')).toEqual([
      'page.mdx:7: only demo fences and blank lines belong inside <Demos>',
      'page.mdx:9: a fence without demo= inside <Demos>',
      'page.mdx:1: <Demos> needs at least two demo fences',
      'page.mdx:14: <Demos> needs at least two demo fences',
      'page.mdx:19: <Demos> is not closed',
    ]);
  });

  it('names the file and line of a block that drifted or points nowhere', () => {
    const page = [
      '# Page',
      '```tsx demo="success"',
      "cloudlet.show({ title: 'Saved', kind: 'success' });",
      '```',
      '```tsx demo="no-such-demo"',
      'cloudlet.clear();',
      '```',
    ].join('\n');
    expect(problems(demoFences(page, 'page.mdx'))).toEqual([
      'page.mdx:2: code differs from the snippet of demo "success"',
      'page.mdx:5: demo "no-such-demo" is not in the catalog (apps/site/src/lib/demos.tsx)',
    ]);
  });

  it('marks only the first runnable fence of a page for the "Snippets assume" line', () => {
    interface Node {
      type: string;
      meta?: string | null;
      children?: Node[];
    }
    const tree: Node & { children: Node[] } = {
      type: 'root',
      children: [
        { type: 'code', meta: 'title="main.tsx"' },
        { type: 'blockquote', children: [{ type: 'code', meta: 'demo="success"' }] },
        { type: 'code', meta: 'demo="error"' },
        { type: 'code', meta: null },
      ],
    };
    remarkDemoNote()(tree, vfile(''));
    const metas = [tree.children[0]!.meta, tree.children[1]!.children![0]!.meta, tree.children[2]!.meta, tree.children[3]!.meta];
    expect(metas).toEqual(['title="main.tsx"', `demo="success" ${DEMO_NOTE}`, 'demo="error"', null]);
  });

  it('writes runnable fences as plain code in the Markdown for agents, the first after the note', () => {
    const source = 'Intro\n\n```tsx demo="success"\nshow();\n```\n\n```tsx demo="error" title="x.tsx"\nfail();\n```\n';
    const at = (text: string) => {
      const start = source.indexOf(text);
      return { start: { offset: start, line: 1, column: 1 }, end: { offset: start + text.length, line: 1, column: 1 } };
    };
    const first = '```tsx demo="success"\nshow();\n```';
    const second = '```tsx demo="error" title="x.tsx"\nfail();\n```';
    const tree = {
      type: 'root',
      position: { start: { offset: 0, line: 1, column: 1 }, end: { offset: source.length, line: 1, column: 1 } },
      children: [
        { type: 'paragraph', position: at('Intro'), children: [{ type: 'text', value: 'Intro', position: at('Intro') }] },
        { type: 'code', lang: 'tsx', meta: 'demo="success"', value: 'show();', position: at(first) },
        { type: 'code', lang: 'tsx', meta: 'demo="error" title="x.tsx"', value: 'fail();', position: at(second) },
      ],
    };
    const file = vfile(source);
    remarkDemoNote()(tree, file);
    const markdown = createStringifier(file).stringify(tree as never);
    expect(markdown).toBe('Intro\n\nSnippets assume `const cloudlet = useCloudlet();`.\n\n```tsx\nshow();\n```\n\n```tsx\nfail();\n```\n');
  });
});

/** What the plugin and the stringifier use of a VFile: its identity and its text. */
function vfile(value: string): Parameters<ReturnType<typeof remarkDemoNote>>[1] {
  return { toString: () => value } as never;
}
