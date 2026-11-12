import { formatColor, oklchToRgb, parseColor, rgbToOklch } from '@/components/ui/color-picker/color';

/**
 * The Palette section's hints (COLOR_PICKER §8.5): the classic harmonies of the page color, turned
 * in OKLCH so a rotated hue keeps the base's lightness and chroma (pulled into sRGB where it does not
 * fit). The base always comes first: a hint fills the palette, and the first color is the page's.
 */

export type HarmonyId = 'complement' | 'split-complement' | 'analogous' | 'tints';

export interface Harmony {
  readonly id: HarmonyId;
  readonly name: string;
  /** `#rrggbb`, the base color first. */
  readonly colors: readonly string[];
}

const mod360 = (degrees: number) => ((degrees % 360) + 360) % 360;

export function harmoniesOf(color: string): readonly Harmony[] {
  const rgba = parseColor(color) ?? { r: 0, g: 0, b: 0, a: 1 };
  const base = formatColor({ ...rgba, a: 1 }, 'hex');
  const { l, c, h } = rgbToOklch({ ...rgba, a: 1 });
  const turn = (degrees: number) => formatColor(oklchToRgb({ l, c, h: mod360(h + degrees), a: 1 }), 'hex');
  // Tints: a quarter, half and three quarters of the way to white, chroma fading with them.
  const tint = (step: number) => formatColor(oklchToRgb({ l: l + (1 - l) * step, c: c * (1 - step * 0.85), h, a: 1 }), 'hex');
  return [
    { id: 'complement', name: 'Complement', colors: [base, turn(180)] },
    { id: 'split-complement', name: 'Split complement', colors: [base, turn(150), turn(210)] },
    { id: 'analogous', name: 'Analogous', colors: [base, turn(-30), turn(30)] },
    { id: 'tints', name: 'Tints', colors: [base, tint(0.25), tint(0.5), tint(0.75)] },
  ];
}
