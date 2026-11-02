import { formatColor, oklchToRgb, parseColor, rgbToOklch } from '@/components/ui/color-picker/color';

/**
 * Combinations (COLOR_PICKER §8.5): the classic harmonies of the picked color, turned in OKLCH so
 * a rotated hue keeps the base's lightness and chroma (pulled into sRGB where it does not fit).
 */

export type HarmonyId = 'complement' | 'split-complement' | 'analogous' | 'tints';

export interface Harmony {
  readonly id: HarmonyId;
  readonly name: string;
  /** `#rrggbb`, the base color included where the harmony has it. */
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
    { id: 'analogous', name: 'Analogous', colors: [turn(-30), base, turn(30)] },
    { id: 'tints', name: 'Tints', colors: [base, tint(0.25), tint(0.5), tint(0.75)] },
  ];
}

const luminance = (color: string) => {
  const { r, g, b } = parseColor(color) ?? { r: 0, g: 0, b: 0 };
  const linear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};

/** WCAG 2 contrast ratio of two colors. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

// Pure black: with any lighter dark ink some mid-tone backgrounds fall under 4.5:1 against both inks.
export const INK_DARK = '#000000';
export const INK_LIGHT = '#ffffff';

/** Text over a color: whichever of black and white contrasts more (always ≥ 4.58:1). */
export const inkOn = (background: string) => (contrast(background, INK_DARK) >= contrast(background, INK_LIGHT) ? INK_DARK : INK_LIGHT);
