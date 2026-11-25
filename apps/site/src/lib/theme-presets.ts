import type { ResolvedTheme } from './theme';

/**
 * Themes for the kit landing's "your theme" principle: values for the shadcn tokens the Color picker
 * and the Color palette read (`color-picker.css`: background, foreground, border, ring, muted), the
 * muted text and a font. They go on the block's wrapper as variables, never on `<html>`; the first
 * one is the page's own tokens, untouched.
 */
export const THEME_TOKENS = ['background', 'foreground', 'muted', 'muted-foreground', 'border', 'ring'] as const;
export type ThemeToken = (typeof THEME_TOKENS)[number];
export type ThemeValues = Readonly<Record<ThemeToken, string>>;

export interface ThemePreset {
  readonly id: string;
  readonly label: string;
  /** null: the page's own tokens and font. */
  readonly tokens: Readonly<Record<ResolvedTheme, ThemeValues>> | null;
  readonly font: string | null;
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  { id: 'cloudlet', label: 'Cloudlet', tokens: null, font: null },
  {
    id: 'paper',
    label: 'Paper',
    tokens: {
      light: { background: '#fcf8f0', foreground: '#1a1209', muted: '#f4ecdf', 'muted-foreground': '#6b563d', border: '#e2d4bc', ring: '#a65a2a' },
      dark: { background: '#221a12', foreground: '#f4eadb', muted: '#31271c', 'muted-foreground': '#c4b197', border: '#4a3a29', ring: '#e09a68' },
    },
    font: "Georgia, 'Times New Roman', serif",
  },
  {
    id: 'terminal',
    label: 'Terminal',
    tokens: {
      light: { background: '#f3f7f4', foreground: '#06140d', muted: '#e2ece5', 'muted-foreground': '#43604f', border: '#c9d9cf', ring: '#137a55' },
      dark: { background: '#0c1511', foreground: '#d4f3e4', muted: '#15231c', 'muted-foreground': '#8fb5a2', border: '#23372d', ring: '#46cf9b' },
    },
    font: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
];

/** The wrapper's variables: both themes' values side by side; kit.css picks one by the page's theme. */
export function presetStyle(preset: ThemePreset): Record<string, string> {
  const style: Record<string, string> = {};
  if (preset.tokens) {
    for (const token of THEME_TOKENS) {
      style[`--tp-light-${token}`] = preset.tokens.light[token];
      style[`--tp-dark-${token}`] = preset.tokens.dark[token];
    }
  }
  if (preset.font) style['--tp-font'] = preset.font;
  return style;
}

/** The preset as an app's stylesheet would hold it, for one theme (`:root` or `.dark`). */
export function presetCss(preset: ThemePreset, theme: ResolvedTheme): readonly (readonly [string, string])[] {
  if (!preset.tokens) return [];
  const lines: (readonly [string, string])[] = THEME_TOKENS.map((token) => [`--${token}`, preset.tokens![theme][token]] as const);
  if (preset.font) lines.push(['--font-sans', preset.font]);
  return lines;
}
