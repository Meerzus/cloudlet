import type * as PageTree from 'fumadocs-core/page-tree';

export interface NavLink {
  readonly url: string;
  readonly name: PageTree.Item['name'];
  readonly external: boolean;
}

export interface NavGroup {
  readonly name: PageTree.Separator['name'] | null;
  readonly links: readonly NavLink[];
}

/**
 * The sidebar's reading of the page tree: separators start groups, folders are
 * flattened into the group they sit in (the Reference pages live in `api/`), links keep their
 * order. Both the desktop sidebar and the phone drawer render the same groups.
 */
export function groupTree(nodes: readonly PageTree.Node[]): NavGroup[] {
  const groups: { name: NavGroup['name']; links: NavLink[] }[] = [];
  const current = () => {
    if (groups.length === 0) groups.push({ name: null, links: [] });
    return groups[groups.length - 1]!;
  };
  const visit = (node: PageTree.Node) => {
    if (node.type === 'separator') {
      groups.push({ name: node.name, links: [] });
      return;
    }
    if (node.type === 'folder') {
      if (node.index) visit(node.index);
      node.children.forEach(visit);
      return;
    }
    current().links.push({ url: node.url, name: node.name, external: node.external ?? !node.url.startsWith('/') });
  };
  nodes.forEach(visit);
  return groups.filter((group) => group.links.length > 0);
}

/** Pathname → tree URL: the static export may serve `/docs/` for `/docs`. */
export function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

export function findCurrent(groups: readonly NavGroup[], pathname: string): NavLink | undefined {
  const path = normalizePath(pathname);
  for (const group of groups) {
    const link = group.links.find((item) => item.url === path);
    if (link) return link;
  }
  return undefined;
}
