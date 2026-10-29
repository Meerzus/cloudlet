interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hProperties?: Record<string, string> };
}

interface MdFile {
  path?: string;
  history?: string[];
}

/** Reference pages live in `content/docs/<lang>/api/` (DOCS.md §4). */
const REFERENCE_PAGE = /[\\/]api[\\/][^\\/]+\.mdx$/u;

const text = (node: MdNode): string => node.value ?? (node.children ?? []).map(text).join('');

function setProperty(node: MdNode, name: string, value: string) {
  node.data = { ...node.data, hProperties: { ...node.data?.hProperties, [name]: value } };
}

function visitTables(node: MdNode, visit: (table: MdNode) => void) {
  if (node.type === 'table') visit(node);
  else for (const child of node.children ?? []) visitTables(child, visit);
}

/**
 * Marks the tables of the Reference pages so that they fit the article: every table gets
 * `data-reference`, a table of three or more columns also `data-grid` (its column count), and
 * every body cell gets its column name as `data-label` (and `data-empty` when it is just "—").
 * `docs.css` lays a grid row out as its first columns on one aligned line (Prop · Type · Default
 * of DOCS.md §5) with the last column, the description, under it; below 40rem every row becomes a
 * card that labels its middle columns and leaves out empty ones. No table scrolls sideways.
 */
export function remarkReferenceTables() {
  return (tree: MdNode, file: MdFile) => {
    const path = file.path ?? file.history?.at(-1) ?? '';
    if (!REFERENCE_PAGE.test(path)) return;
    visitTables(tree, (table) => {
      const [head, ...rows] = table.children ?? [];
      const labels = (head?.children ?? []).map((cell) => text(cell).trim());
      setProperty(table, 'data-reference', '');
      if (labels.length >= 3) setProperty(table, 'data-grid', String(labels.length));
      for (const row of rows) {
        (row.children ?? []).forEach((cell, index) => {
          setProperty(cell, 'data-label', labels[index] ?? '');
          if (text(cell).trim() === '—') setProperty(cell, 'data-empty', '');
        });
      }
    });
  };
}
