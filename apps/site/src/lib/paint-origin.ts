import type { ChangeSource } from '@/components/picker/picker-color';
import type { PageRect } from './paint-calm';

/** Where a new ramp spreads from: a control's box in page coordinates (a point is an empty box), with its corner radius. */
export type BleedOrigin = PageRect & { readonly radius: number };

/** A source of a change as the renderer takes it: a box in page coordinates with its corner radius. */
export function bleedOrigin(source: ChangeSource): BleedOrigin {
  if (!('getBoundingClientRect' in source)) return { x: source.x, y: source.y, width: 0, height: 0, radius: 0 };
  // A wrapper round an inline panel spreads from the panel itself, with its rounded corners.
  const target = source.matches('.color-picker-inline') ? source : (source.querySelector('.color-picker-inline') ?? source);
  const box = target.getBoundingClientRect();
  const radius = Number.parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0;
  return { x: box.left + window.scrollX, y: box.top + window.scrollY, width: box.width, height: box.height, radius };
}
