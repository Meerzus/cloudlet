import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../../apps/site/src/', import.meta.url);
const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter((path) => path.endsWith('.tsx'));

describe('site external links', () => {
  it('leaves the site only through ExternalLink, which opens a new tab', () => {
    const external = readFileSync(new URL('components/site/external-link.tsx', SRC), 'utf8');
    expect(external).toContain('target="_blank" rel="noreferrer"');

    // A bare <a> may only point inside the site: a path constant, an absolute path or a hash.
    const bare = files.flatMap((path) =>
      [...readFileSync(new URL(path, SRC), 'utf8').matchAll(/<a\s[^>]*?href=(\{`[^`]*`\}|\{[^}]*\}|"[^"]*")/g)]
        .map((match) => match[1] ?? '')
        .filter((href) =>!/^\{[A-Z_]+_PATH\}$|^"\/|^\{`#/.test(href))
        .map((href) => `${path}: ${href}`),
    );
    expect(bare).toEqual([]);
  });
});
