import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEMO_META } from '../../apps/site/src/lib/remark-demo-note';
import { demoSections, runnableMarkdown } from '../../apps/site/src/lib/runnable-markdown';

/**
 * The Markdown for agents writes a runnable snippet once: the Examples of the component page fold
 * a demo whose code a guide's Markdown already has into a line that points to that guide, and keep
 * every other demo as code — the only copy an agent gets.
 */
const NOTE = 'Snippets assume `const cloudlet = useCloudlet();`.';
const TOASTER = new URL('../../apps/site/content/docs/en/components/toaster/', import.meta.url);

/** Demo ids of an MDX page, in order. */
const demosOf = (mdx: string) => [...mdx.matchAll(/^```\S* (.*)$/gmu)].flatMap((match) => DEMO_META.exec(match[1]!)?.[1] ?? []);

describe('site docs Markdown for agents', () => {
  it('folds the demos it is told to into lines and keeps the rest as code, the note above the first code', () => {
    const markdown = [
      '### Stack',
      '```tsx demo="burst"\nburst();\n```',
      '```tsx demo="success"\nshow();\n```',
      '```tsx demo="error"\nfail();\n```',
    ].join('\n\n');
    const folded = new Map([['burst', '`burst` (Burst): code in [Notifications & time › The stack and the Island](/docs/x#y).']]);
    expect(runnableMarkdown(markdown, folded)).toBe([
      '### Stack',
      '- `burst` (Burst): code in [Notifications & time › The stack and the Island](/docs/x#y).',
      `${NOTE}\n\n\`\`\`tsx\nshow();\n\`\`\``,
      '```tsx\nfail();\n```',
    ].join('\n\n'));
    expect(runnableMarkdown(markdown)).toContain(`${NOTE}\n\n\`\`\`tsx\nburst();\n\`\`\``);
    expect(runnableMarkdown('```tsx title="a.ts"\nplain();\n```')).toBe('```tsx title="a.ts"\nplain();\n```');
  });

  it('finds the section of every runnable fence, not counting headings inside code', () => {
    const markdown = ['## Attention', '```tsx demo="attention-auto"\n## not a heading\n```', '## Capacity and overflow', '```md\n## Inside\n```', '```tsx demo="overflow"\nx();\n```'].join('\n\n');
    expect([...demoSections(markdown)]).toEqual([['attention-auto', 'Attention'], ['overflow', 'Capacity and overflow']]);
  });

  it('folds exactly the Examples demos that a Toaster guide shows, and keeps the others as code', () => {
    const guides = readdirSync(TOASTER).filter((entry) => entry.endsWith('.mdx') && entry !== 'index.mdx');
    const inGuides = new Set(guides.flatMap((entry) => demosOf(readFileSync(new URL(entry, TOASTER), 'utf8'))));
    const examples = demosOf(readFileSync(new URL('index.mdx', TOASTER), 'utf8'));
    const page = examples.map((id) => `\`\`\`tsx demo="${id}"\n${id}();\n\`\`\``).join('\n\n');
    const folded = new Map([...inGuides].map((id) => [id, `\`${id}\`: in a guide.`]));
    const markdown = runnableMarkdown(page, folded);
    for (const id of examples) {
      if (inGuides.has(id)) {
        expect(markdown, id).toContain(`- \`${id}\`: in a guide.`);
        expect(markdown, id).not.toContain(`${id}();`);
      } else expect(markdown, id).toContain(`\`\`\`tsx\n${id}();\n\`\`\``);
    }
    // Kinds, Content and the Promises only the component page shows stay code.
    for (const id of ['success', 'description', 'track-resolve', 'error-retry', 'update-loading']) expect(inGuides.has(id), id).toBe(false);
    expect(markdown).not.toMatch(/demo="/u);
  });
});
