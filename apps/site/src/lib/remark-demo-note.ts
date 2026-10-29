import { replaceSource } from 'fumadocs-core/mdx-plugins/stringifier';
import { DOCS_UI } from './docs-ui-strings';

/** The meta of a runnable fence: ```tsx demo="success" */
export const DEMO_META = /(?:^|\s)demo="([^"]+)"/u;
/** The word this plugin appends to the meta of the first runnable fence of a page. */
export const DEMO_NOTE = 'demo-note';

type SourceFile = Parameters<typeof replaceSource>[0];
type SourceNode = Parameters<typeof replaceSource>[1];

interface MdNode {
  type: string;
  lang?: string | null;
  meta?: string | null;
  value?: string;
  children?: MdNode[];
}

function demoFences(node: MdNode, found: MdNode[] = []): MdNode[] {
  if (node.type === 'code' && node.meta && DEMO_META.test(node.meta)) found.push(node);
  for (const child of node.children ?? []) demoFences(child, found);
  return found;
}

/**
 * Marks the first runnable fence of every page, so its code block can say once what the
 * snippets assume (`const cloudlet = useCloudlet();`, as on the Playground). Done at build
 * time: the line is in the static HTML and nothing shifts after hydration.
 *
 * The Markdown of the page (`/docs/<slug>.md`, `llms-full.txt`) gets every runnable
 * fence as plain code, the first one after the same sentence: there is no Run button to explain.
 */
export function remarkDemoNote() {
  return (tree: MdNode, file: SourceFile) => {
    const fences = demoFences(tree);
    fences.forEach((fence, index) => {
      const code = `\`\`\`${fence.lang ?? ''}\n${fence.value ?? ''}\n\`\`\``;
      const note = `${DOCS_UI.demoNoteBefore}\`${DOCS_UI.demoNoteCode}\`.\n\n`;
      replaceSource(file, fence as SourceNode, index === 0 ? `${note}${code}` : code);
    });
    const first = fences[0];
    if (first) first.meta = `${first.meta} ${DEMO_NOTE}`;
  };
}
