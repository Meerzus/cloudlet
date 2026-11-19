import { DOCS_UI } from './docs-ui-strings';

/*
 * Runnable fences in the Markdown for agents. remark-demo-note.ts leaves each one in the processed
 * Markdown as ```lang demo="<id>"; docs-markdown.ts decides which demos a page folds into links
 * and writes the page with these helpers. No content source here, so tests import it directly.
 */

/** A fence line: up to three spaces, three or more backticks or tildes, then the info string. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/u;
/** The info string of a runnable fence as remark-demo-note.ts leaves it: `tsx demo="<id>"`. */
const RUNNABLE = /^(\S*) demo="([^"]+)"$/u;

type Part =
  | { readonly kind: 'line'; readonly line: string }
  | { readonly kind: 'code'; readonly open: string; readonly info: string; readonly code: readonly string[]; readonly close: string | null };

/**
 * A page's Markdown as lines of text and fenced blocks. A block ends at a fence of the same
 * character, at least as long as the one that opened it, with nothing after it; a shorter fence or
 * one of the other character is code inside the block, so a fence shown inside a longer fence stays
 * literal. A block left open runs to the end (`close` is null).
 */
function* parts(markdown: string): Generator<Part> {
  const lines = markdown.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const opened = FENCE.exec(line);
    if (!opened) {
      yield { kind: 'line', line };
      continue;
    }
    const marker = opened[1] ?? '';
    const code: string[] = [];
    let close: string | null = null;
    for (index += 1; index < lines.length; index += 1) {
      const inner = lines[index] ?? '';
      const fence = FENCE.exec(inner);
      if (fence && fence[1]?.[0] === marker[0] && (fence[1]?.length ?? 0) >= marker.length && fence[2]?.trim() === '') {
        close = inner;
        break;
      }
      code.push(inner);
    }
    yield { kind: 'code', open: line, info: (opened[2] ?? '').trim(), code, close };
  }
}

/**
 * Runnable fences of a page's Markdown: a demo in `folded` becomes one list line (what it shows
 * and where its code is), every other one stays plain code, and the first code that stays gets the
 * note on what the snippets assume. `folded` maps a demo id to that line. Only a closed
 * triple-backtick fence at the start of a line is runnable; anything else is left as written.
 */
export function runnableMarkdown(markdown: string, folded: ReadonlyMap<string, string> = new Map()): string {
  let noted = false;
  const out: string[] = [];
  for (const part of parts(markdown)) {
    if (part.kind === 'line') {
      out.push(part.line);
      continue;
    }
    const runnable = part.close !== null && part.open.startsWith('```') && !part.open.startsWith('````') ? RUNNABLE.exec(part.info) : null;
    if (!runnable) {
      out.push(part.open, ...part.code, ...(part.close === null ? [] : [part.close]));
      continue;
    }
    const line = folded.get(runnable[2] ?? '');
    if (line) {
      out.push(`- ${line}`);
      continue;
    }
    if (!noted) out.push(`${DOCS_UI.demoNoteBefore}\`${DOCS_UI.demoNoteCode}\`.`, '');
    noted = true;
    out.push(`\`\`\`${runnable[1] ?? ''}`, ...part.code, '```');
  }
  return out.join('\n');
}

/** The runnable fences of a page's Markdown, each with the heading of the section it sits in. */
export function demoSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  let heading = '';
  for (const part of parts(markdown)) {
    if (part.kind === 'line') {
      const title = /^#{2,6} (.+)$/u.exec(part.line)?.[1];
      if (title) heading = title.trim();
      continue;
    }
    const id = /(?:^|\s)demo="([^"]+)"/u.exec(part.info)?.[1];
    if (id && !sections.has(id)) sections.set(id, heading);
  }
  return sections;
}
