import { DOCS_UI } from './docs-ui-strings';

/*
 * Runnable fences in the Markdown for agents. remark-demo-note.ts leaves each one in the processed
 * Markdown as ```lang demo="<id>"; docs-markdown.ts decides which demos a page folds into links
 * and writes the page with these helpers. No content source here, so tests import it directly.
 */

/** A runnable fence as remark-demo-note.ts leaves it in the processed Markdown: ```tsx demo="<id>". */
const RUNNABLE = /^```(\S*) demo="([^"]+)"\n([\s\S]*?)\n```$/gmu;

/**
 * Runnable fences of a page's Markdown: a demo in `folded` becomes one list line (what it shows
 * and where its code is), every other one stays plain code, and the first code that stays gets the
 * note on what the snippets assume. `folded` maps a demo id to that line.
 */
export function runnableMarkdown(markdown: string, folded: ReadonlyMap<string, string> = new Map()): string {
  let noted = false;
  return markdown.replace(RUNNABLE, (_, lang: string, id: string, code: string) => {
    const line = folded.get(id);
    if (line) return `- ${line}`;
    const note = noted ? '' : `${DOCS_UI.demoNoteBefore}\`${DOCS_UI.demoNoteCode}\`.\n\n`;
    noted = true;
    return `${note}\`\`\`${lang}\n${code}\n\`\`\``;
  });
}

/** The runnable fences of a page's Markdown, each with the heading of the section it sits in. */
export function demoSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  let heading = '';
  let open: string | undefined;
  for (const line of markdown.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (open) {
      if (marker && line.trim() === open) open = undefined;
      continue;
    }
    if (marker) {
      open = marker[1];
      const id = /(?:^|\s)demo="([^"]+)"/u.exec(marker[2] ?? '')?.[1];
      if (id && !sections.has(id)) sections.set(id, heading);
      continue;
    }
    const title = /^#{2,6} (.+)$/u.exec(line)?.[1];
    if (title) heading = title.trim();
  }
  return sections;
}
