import { replaceSource } from 'fumadocs-core/mdx-plugins/stringifier';

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
 * snippets assume (`const cloudlet = useCloudlet();`). Done at build
 * time: the line is in the static HTML and nothing shifts after hydration.
 *
 * The Markdown of the page (`/docs/<slug>.md`, `llms-full.txt`) gets every runnable
 * fence as `lang demo="<id>"` and its code, without a title or the note: `docs-markdown.ts`
 * decides per demo whether the code stays or becomes a link to the guide that shows it, and
 * writes the note above the first code that stays. There is no Run button to explain.
 */
export function remarkDemoNote() {
  return (tree: MdNode, file: SourceFile) => {
    const fences = demoFences(tree);
    fences.forEach((fence) => {
      const id = DEMO_META.exec(fence.meta ?? '')?.[1] ?? '';
      replaceSource(file, fence as SourceNode, `\`\`\`${fence.lang ?? ''} demo="${id}"\n${fence.value ?? ''}\n\`\`\``);
    });
    const first = fences[0];
    if (first) first.meta = `${first.meta} ${DEMO_NOTE}`;
  };
}
