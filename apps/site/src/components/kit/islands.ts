import type { CLOUD_SHAPES } from '@/lib/clouds.generated';
import type { RegistryItem } from '@/lib/site';

export type CloudShape = (typeof CLOUD_SHAPES)[number]['id'];

/** Where an island sits: its left edge and width in % of the box's width, its top in % of its height. */
export interface IslandPlace {
  readonly x: number;
  readonly y: number;
  readonly w: number;
}

/**
 * A cloud in the kit's hero. A component's island carries the live component (`component`); the
 * others are plain clouds for depth. `depth` 0 is far (smaller, softer, slower, later in), 1 is near.
 */
export interface Island {
  readonly id: string;
  readonly component?: RegistryItem;
  readonly shape: CloudShape;
  readonly depth: number;
  readonly flip?: boolean;
  /** From 64rem: around the words, in % of the hero. */
  readonly wide: IslandPlace;
  /** Narrower: in the band under the words, in % of the band; null keeps the island off narrow screens. */
  readonly narrow: IslandPlace | null;
}

/**
 * Narrow screens fit this many components under the words. A kit with more keeps every island on
 * wide screens; on narrow ones the extra components stay in the install switch only (their island
 * gets `narrow: null`), so the band never grows into a second screen.
 */
export const NARROW_COMPONENTS = 3;

/**
 * The hero's clouds, far to near (later ones paint over earlier ones). A new component of the kit is
 * one more entry here with its `component` id, and what rests on it in the hero; nothing else moves.
 */
export const ISLANDS: readonly Island[] = [
  { id: 'far', shape: 4, depth: 0.15, wide: { x: 3, y: 15, w: 22 }, narrow: null },
  { id: 'color-palette', component: 'color-palette', shape: 5, depth: 0.35, wide: { x: 74, y: 21, w: 22 }, narrow: { x: 40, y: 0, w: 60 } },
  { id: 'color-picker', component: 'color-picker', shape: 6, depth: 0.6, flip: true, wide: { x: 1, y: 55, w: 28 }, narrow: { x: -6, y: 20, w: 62 } },
  { id: 'toaster', component: 'toaster', shape: 1, depth: 1, wide: { x: 64, y: 64, w: 34 }, narrow: { x: 6, y: 52, w: 88 } },
  { id: 'near', shape: 6, depth: 1, wide: { x: -10, y: 88, w: 40 }, narrow: null },
];
