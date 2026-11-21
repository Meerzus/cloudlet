import { COLOR_FORMATS, detectFormat, formatColor, parseColor, type ColorFormat } from '@/components/ui/color-picker/color';

/**
 * The settings of the color picker's and the color palette's Preview as a visitor picks them, and
 * the code each combination makes: a small client component a reader can paste, with every prop at
 * its default left out. The Markdown of the pages describes the same controls.
 */

export type PickerKind = 'swatch' | 'panel';
export type Opacity = 'off' | 'on';
export type PaletteMax = '2' | '3' | '4';

export const PICKER_KINDS: readonly { value: PickerKind; label: string }[] = [
  { value: 'swatch', label: 'Swatch' },
  { value: 'panel', label: 'Panel' },
];
export const FORMATS: readonly { value: ColorFormat; label: string }[] = COLOR_FORMATS.map((format) => ({ value: format, label: format }));
export const OPACITIES: readonly { value: Opacity; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
];
export const PALETTE_MAXES: readonly { value: PaletteMax; label: string }[] = [
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
];

/** The component a kind stands for. */
export const PICKER_COMPONENTS: Readonly<Record<PickerKind, string>> = { swatch: 'ColorPicker', panel: 'ColorPickerPanel' };

/** The color the picker's Preview starts from, and the three the palette's starts from. */
export const PREVIEW_COLOR = '#245cdb';
export const PREVIEW_COLORS: readonly string[] = ['#245cdb', '#f2b84b', '#2f8f9d'];
/** `max` of the palette when the prop is left out. */
export const DEFAULT_MAX: PaletteMax = '4';

/**
 * A color rewritten in `format`, without its opacity unless `alpha`: what the picker itself would
 * give for it. A color already in that form, or one that does not parse, is returned as it is.
 */
export function inFormat(color: string, format: ColorFormat, alpha: boolean): string {
  const rgba = parseColor(color);
  if (!rgba || (detectFormat(color) === format && (alpha || rgba.a >= 1))) return color;
  return formatColor(alpha ? rgba : { ...rgba, a: 1 }, format);
}

/**
 * `colors` rewritten in `format` by the Format control of a Preview. A format keeps fewer digits
 * than a color has (hsl, whole percents), so a color rewritten from its own string would shift a
 * little with every switch. `origins` remembers what each rewritten color came from: until the
 * reader changes a color, every format is written from that one.
 */
export function rewriteColors(colors: readonly string[], format: ColorFormat, alpha: boolean, origins: Map<string, string>): string[] {
  const rewritten = colors.map((color) => {
    const origin = origins.get(color) ?? color;
    return [inFormat(origin, format, alpha), origin] as const;
  });
  origins.clear();
  for (const [value, origin] of rewritten) origins.set(value, origin);
  return rewritten.map(([value]) => value);
}

export interface PickerSettings {
  readonly kind: PickerKind;
  readonly format: ColorFormat;
  readonly alpha: boolean;
}

export interface PaletteSettings {
  readonly max: PaletteMax;
  readonly format: ColorFormat;
  readonly alpha: boolean;
}

/** `defaultFormat` and `alpha` as JSX attributes; the defaults (`hex`, no opacity) are left out. */
const shared = ({ format, alpha }: { format: ColorFormat; alpha: boolean }) => `${format === 'hex' ? '' : ` defaultFormat="${format}"`}${alpha ? ' alpha' : ''}`;

/**
 * The picker of the Preview as a component: the starting color written in the format, which
 * `defaultFormat` then keeps until the reader switches it, as on the stage.
 */
export function pickerCode(settings: PickerSettings): string {
  const component = PICKER_COMPONENTS[settings.kind];
  return [
    '"use client";',
    '',
    'import { useState } from "react";',
    `import { ${component} } from "@/components/ui/color-picker/color-picker";`,
    '',
    'export function AccentColor() {',
    `  const [color, setColor] = useState("${inFormat(PREVIEW_COLOR, settings.format, false)}");`,
    `  return <${component} color={color} onChange={setColor}${shared(settings)} />;`,
    '}',
  ].join('\n');
}

/** The colors the palette's Preview holds at a `max`: the starting three, or the first two of them. */
export const paletteColors = (max: PaletteMax): readonly string[] => PREVIEW_COLORS.slice(0, Number(max));

/** The palette of the Preview as a component, by the same rules as the picker's. */
export function paletteCode(settings: PaletteSettings): string {
  const colors = paletteColors(settings.max).map((color) => `"${inFormat(color, settings.format, false)}"`);
  return [
    '"use client";',
    '',
    'import { useState } from "react";',
    'import { ColorPalette } from "@/components/ui/color-palette/color-palette";',
    '',
    'export function BrandColors() {',
    '  const [colors, setColors] = useState([',
    ...colors.map((color) => `    ${color},`),
    '  ]);',
    `  return <ColorPalette colors={colors} onChange={setColors}${settings.max === DEFAULT_MAX ? '' : ` max={${settings.max}}`}${shared(settings)} />;`,
    '}',
  ].join('\n');
}

/** The name of a combination in the table of codes a Preview is given. */
export const pickerKey = ({ kind, format, alpha }: PickerSettings) => `${kind}-${format}-${alpha ? 'alpha' : 'opaque'}`;
export const paletteKey = ({ max, format, alpha }: PaletteSettings) => `${max}-${format}-${alpha ? 'alpha' : 'opaque'}`;

const ALPHAS = [false, true] as const;

/** Every code the picker's Preview can show, by key. */
export function pickerCodes(): Record<string, string> {
  const codes: Record<string, string> = {};
  for (const { value: kind } of PICKER_KINDS) for (const format of COLOR_FORMATS) for (const alpha of ALPHAS) codes[pickerKey({ kind, format, alpha })] = pickerCode({ kind, format, alpha });
  return codes;
}

/** Every code the palette's Preview can show, by key. */
export function paletteCodes(): Record<string, string> {
  const codes: Record<string, string> = {};
  for (const { value: max } of PALETTE_MAXES) for (const format of COLOR_FORMATS) for (const alpha of ALPHAS) codes[paletteKey({ max, format, alpha })] = paletteCode({ max, format, alpha });
  return codes;
}

const values = (list: readonly string[]) => list.map((value) => `\`${value}\``).join(', ');
const tsx = (code: string) => `\`\`\`tsx\n${code}\n\`\`\``;
const [defaultFormat, ...otherFormats] = COLOR_FORMATS;

/** The picker's Preview in the Markdown for agents: where it lives, a code it makes and what the controls set. */
export function pickerPreviewMarkdown(url: string): string {
  return [
    `Live preview at ${url}: the picker as a swatch or as an inline panel, the value its \`onChange\` gives, and controls for the component, the output format and opacity. The code they make:`,
    tsx(pickerCode({ kind: 'panel', format: 'oklch', alpha: true })),
    [
      `- Component: \`${PICKER_COMPONENTS.swatch}\` (the swatch that opens the picker) or \`${PICKER_COMPONENTS.panel}\` (the picker inline).`,
      `- \`defaultFormat\`: \`${defaultFormat}\` (the default), ${values(otherFormats)}; the starting color is written in it.`,
      '- `alpha`: off by default; on, the picker shows the opacity slider.',
    ].join('\n'),
    `A prop at its default is left out; with every default the code is \`<${PICKER_COMPONENTS.swatch} color={color} onChange={setColor} />\`.`,
  ].join('\n\n');
}

/** The palette's Preview in the Markdown for agents. */
export function palettePreviewMarkdown(url: string): string {
  return [
    `Live preview at ${url}: a palette of three colors, the array its \`onChange\` gives, and controls for the most colors it holds, the output format and opacity. The code they make:`,
    tsx(paletteCode({ max: '3', format: 'oklch', alpha: true })),
    [
      `- \`max\`: ${values(PALETTE_MAXES.filter(({ value }) => value !== DEFAULT_MAX).map(({ value }) => value))}, \`${DEFAULT_MAX}\` (the default); the add button is gone at this count.`,
      `- \`defaultFormat\`: \`${defaultFormat}\` (the default), ${values(otherFormats)}; every color is written in it.`,
      '- `alpha`: off by default; on, every picker shows the opacity slider.',
    ].join('\n'),
    'A prop at its default is left out; with every default the code is `<ColorPalette colors={colors} onChange={setColors} />`.',
  ].join('\n\n');
}
