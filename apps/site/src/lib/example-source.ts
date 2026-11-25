import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The source of a live example of the docs: `<Example name="color-picker/panel" />` renders the
 * component of `src/components/docs/examples/color-picker/panel.tsx` and shows this very file as
 * its code, on the page and in the Markdown for agents. Read at build time (server only).
 */
const EXAMPLES_DIR = 'src/components/docs/examples';
const NAME = /^[a-z0-9-]+\/[a-z0-9-]+$/u;

export interface ExampleSource {
  /** The file name shown above the code: `panel.tsx`. */
  readonly file: string;
  readonly code: string;
}

export function exampleSource(name: string | undefined): ExampleSource {
  if (!name || !NAME.test(name)) throw new Error(`Unknown example "${name}" in a documentation page: the name is "<component>/<file>"`);
  // The site builds from its own folder; tests run from the repository root.
  const path = [process.cwd(), join(process.cwd(), 'apps/site')].map((root) => join(root, EXAMPLES_DIR, `${name}.tsx`)).find((file) => existsSync(file));
  if (!path) throw new Error(`Unknown example "${name}" in a documentation page: no ${EXAMPLES_DIR}/${name}.tsx`);
  return { file: `${name.slice(name.indexOf('/') + 1)}.tsx`, code: readFileSync(path, 'utf8').trimEnd() };
}

/** The example in the Markdown for agents: the code of its file under the file's name. */
export function exampleMarkdown(name: string | undefined): string {
  const { file, code } = exampleSource(name);
  return `\`\`\`tsx title="${file}"\n${code}\n\`\`\``;
}
