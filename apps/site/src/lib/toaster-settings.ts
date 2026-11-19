import type { ToasterProps } from '@cloudlet/toast';

/**
 * The page Toaster's live settings as a visitor picks them: an edge, a side and a direction, the
 * `position` they make and the `<Toaster />` code that sets it, for the component page's Preview
 * and the Markdown of that page.
 */

export type Edge = 'auto' | 'top' | 'bottom';
export type Side = 'left' | 'center' | 'right';
export type Position = NonNullable<ToasterProps['position']>;
export type Direction = NonNullable<ToasterProps['dir']>;

export const EDGES: readonly { value: Edge; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
];
export const SIDES: readonly { value: Side; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];
export const DIRECTIONS: readonly { value: Direction; label: string }[] = [
  { value: 'ltr', label: 'LTR' },
  { value: 'rtl', label: 'RTL' },
];

/** Every value of `<Toaster position>`, `auto` (the default) first. */
export const POSITIONS: readonly Position[] = ['auto', 'top-center', 'bottom-center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];

/** Where `position="auto"` switches from the bottom to the top edge (the Toaster's own threshold). */
export const AUTO_BREAKPOINT = '48rem';

/**
 * `auto` exists only in the centre: with Position = Auto the Side is Center and Left / Right are off,
 * so the position is `auto` whatever the side state and the width.
 */
export function positionOf(edge: Edge, side: Side): Position {
  if (edge === 'auto') return 'auto';
  return `${edge}-${side}`;
}

/** Whether a side can be picked on an edge: every side on Top and Bottom, only Center on Auto. */
export const sideEnabled = (edge: Edge, side: Side) => edge !== 'auto' || side === 'center';

/** One token of the code: its text and the Shiki theme variable it is coloured with. */
export interface CodeToken {
  readonly content: string;
  readonly color: string;
}

const FOREGROUND = 'var(--shiki-foreground)';
const TAG = 'var(--shiki-token-constant)';
const ATTRIBUTE = 'var(--shiki-token-function)';
const EQUALS = 'var(--shiki-token-keyword)';
const STRING = 'var(--shiki-token-string-expression)';

/**
 * `<Toaster />` with the props that differ from the defaults (`position="auto"`, `dir="ltr"` on a
 * left-to-right page), as tokens coloured the way Shiki colours the same line at build time
 * (a unit test compares them for every setting).
 */
export function toasterCode({ position, dir }: { position: Position; dir: Direction }): readonly CodeToken[] {
  const props: [string, string][] = [];
  if (position !== 'auto') props.push(['position', position]);
  if (dir !== 'ltr') props.push(['dir', dir]);
  return [
    { content: '<', color: FOREGROUND },
    { content: 'Toaster', color: TAG },
    ...props.flatMap(([name, value]): CodeToken[] => [
      { content: ' ', color: FOREGROUND },
      { content: name, color: ATTRIBUTE },
      { content: '=', color: EQUALS },
      { content: `"${value}"`, color: STRING },
    ]),
    { content: ' />', color: FOREGROUND },
  ];
}

/** The plain text of the code, as Copy gives it. */
export const codeText = (tokens: readonly CodeToken[]) => tokens.map((token) => token.content).join('');
