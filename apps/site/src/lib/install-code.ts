import type { RegistryItem } from './site';

/**
 * The few lines each item takes once the shadcn CLI has added it, as the kit's install section shows
 * them: the imports, then the lines that use it. The module paths are where the CLI puts the item's
 * files (`components/ui/…`, the docs' install tables); tests/unit/site-kit-install.test.ts holds every
 * imported name to an export of the item's own files or of its npm dependency.
 */

export interface SnippetImport {
  readonly names: readonly string[];
  readonly from: string;
}

export interface InstallSnippet {
  /** What the item adds to a project, as the docs' installation table says it. */
  readonly adds: string;
  readonly imports: readonly SnippetImport[];
}

/** The notification kinds the Toaster's line cycles through; all are `NotificationKind`s of the package. */
export const SNIPPET_KINDS = ['success', 'info', 'warning', 'error'] as const;
export type SnippetKind = (typeof SNIPPET_KINDS)[number];

/** What the visitor has set in the live lines; the copied code carries it. */
export interface SnippetValues {
  readonly title: string;
  readonly kind: SnippetKind;
  readonly accent: string;
  readonly colors: readonly string[];
}

export const SNIPPET_START: SnippetValues = {
  title: 'Saved',
  kind: 'success',
  accent: '#4c94db',
  colors: ['#4c94db', '#f5b83d', '#e5484d'],
};

export const INSTALL_SNIPPETS: Readonly<Record<RegistryItem, InstallSnippet>> = {
  toaster: {
    adds: 'A wrapper and a theme bridge you own, and @cloudlet/toast from npm as their dependency.',
    imports: [
      { names: ['createCloudlet'], from: '@cloudlet/toast' },
      { names: ['Toaster'], from: '@/components/ui/toaster' },
    ],
  },
  'color-picker': {
    adds: 'The picker’s source and its styles. Nothing goes into package.json.',
    imports: [
      { names: ['useState'], from: 'react' },
      { names: ['ColorPicker'], from: '@/components/ui/color-picker/color-picker' },
    ],
  },
  'color-palette': {
    adds: 'The palette’s source, and the color picker it is built on.',
    imports: [
      { names: ['useState'], from: 'react' },
      { names: ['ColorPalette'], from: '@/components/ui/color-palette/color-palette' },
    ],
  },
};

export function importLine({ names, from }: SnippetImport): string {
  return `import { ${names.join(', ')} } from "${from}";`;
}

/** A string literal as the snippet writes it: double quotes, the title's own quotes escaped. */
export function quoted(value: string): string {
  return JSON.stringify(value);
}

/** The lines after the imports, with the visitor's values: what the section shows and what Copy copies. */
export function usageLines(item: RegistryItem, values: SnippetValues): string[] {
  switch (item) {
    case 'toaster':
      return [
        'const controller = createCloudlet();',
        '<Toaster controller={controller} />',
        `controller.show({ title: ${quoted(values.title)}, kind: ${quoted(values.kind)} });`,
      ];
    case 'color-picker':
      return [`const [accent, setAccent] = useState(${quoted(values.accent)});`, '<ColorPicker color={accent} onChange={setAccent} />'];
    case 'color-palette':
      return [
        `const [colors, setColors] = useState([${values.colors.map(quoted).join(', ')}]);`,
        '<ColorPalette colors={colors} onChange={setColors} />',
      ];
  }
}

/** The whole snippet as text. */
export function snippetCode(item: RegistryItem, values: SnippetValues): string {
  return [...INSTALL_SNIPPETS[item].imports.map(importLine), '', ...usageLines(item, values)].join('\n');
}
