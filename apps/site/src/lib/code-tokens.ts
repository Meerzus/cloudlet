import { codeToTokens } from 'shiki';
import { SHIKI_THEME } from './shiki-theme';
import type { CodeTable } from './code-table';
import type { CodeToken } from './toaster-settings';

/**
 * TSX as lines of tokens coloured by the documentation's Shiki theme, for code that does not come
 * from a fence of the MDX: the file of a live example, the codes a Preview switches between. Runs
 * at build time, in server components; nothing from Shiki ships to the browser.
 */
export async function codeTokens(code: string): Promise<CodeToken[][]> {
  const { tokens } = await codeToTokens(code, { lang: 'tsx', theme: SHIKI_THEME });
  return tokens.map((line) => line.map((token) => ({ content: token.content, color: token.color ?? 'var(--shiki-foreground)' })));
}

/** The codes a Preview switches between, coloured once at build time and without repeating a line. */
export async function codeTable(sources: Readonly<Record<string, string>>): Promise<CodeTable> {
  const lines: CodeToken[][] = [];
  const places = new Map<string, number>();
  const codes: Record<string, number[]> = {};
  for (const [key, source] of Object.entries(sources)) {
    codes[key] = (await codeTokens(source)).map((line) => {
      const id = JSON.stringify(line);
      let place = places.get(id);
      if (place === undefined) {
        place = lines.push(line) - 1;
        places.set(id, place);
      }
      return place;
    });
  }
  return { lines, codes };
}
