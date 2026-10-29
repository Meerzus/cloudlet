/**
 * A tiny TSX highlighter for the Get started snippets: enough for imports, JSX and
 * string literals, with no runtime dependency. Joining the tokens' text returns the
 * source unchanged (tests/unit/site-get-started.test.ts).
 */

export type TokenKind = 'comment' | 'string' | 'keyword' | 'tag' | 'type' | 'function' | 'number' | 'punctuation' | 'plain';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

const KEYWORDS = new Set([
  'import', 'from', 'export', 'function', 'return', 'const', 'let', 'if', 'else', 'null', 'type', 'typeof',
  'interface', 'extends', 'new', 'true', 'false', 'undefined', 'async', 'await',
]);

const RULES: readonly (readonly [TokenKind | 'word', RegExp])[] = [
  ['comment', /\/\/[^\n]*/y],
  ['string', /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/y],
  // JSX tag names: `<` after whitespace, `(`, `>` or `{` (not a generic like `useState<T>`).
  ['tag', /(?<=(?:^|[\s(>{])<\/?)[A-Za-z][\w.]*/y],
  // JSX text between a tag and its closing tag on one line, e.g. `>Notify</`.
  ['plain', /(?<=>)[^<>{}\n]+(?=<\/)/y],
  ['number', /\b\d+(?:\.\d+)?\b/y],
  ['word', /[A-Za-z_$][\w$]*/y],
  ['punctuation', /[{}()[\]<>/=;:,.?!&|+*-]+/y],
  ['plain', /\s+|./y],
];

export function highlight(source: string): Token[] {
  const tokens: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    const last = tokens.at(-1);
    if (last && last.kind === kind) tokens[tokens.length - 1] = { kind, text: last.text + text };
    else tokens.push({ kind, text });
  };
  let index = 0;
  while (index < source.length) {
    for (const [kind, pattern] of RULES) {
      pattern.lastIndex = index;
      const match = pattern.exec(source);
      if (!match || match[0] === '') continue;
      const text = match[0];
      if (kind === 'word') {
        // A call, also with type arguments: `show(`, `useState<T>(`.
        const call = /^\s*(?:<[^<>()]*>\s*)?\(/.test(source.slice(index + text.length));
        push(
          KEYWORDS.has(text) ? 'keyword'
            : call ? 'function'
              : /^[A-Z]/.test(text) ? 'type'
                : 'plain',
          text,
        );
      } else push(kind, text);
      index += text.length;
      break;
    }
  }
  return tokens;
}
