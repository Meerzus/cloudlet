'use client';

import { useRef, useState } from 'react';
import { Segmented } from '@/components/site/segmented';
import { ColorPalette } from '@/components/ui/color-palette/color-palette';
import type { ColorFormat } from '@/components/ui/color-picker/color-picker';
import { tableCode, type CodeTable } from '@/lib/code-table';
import { DOCS_UI } from '@/lib/docs-ui-strings';
import { DEFAULT_MAX, FORMATS, inFormat, OPACITIES, PALETTE_MAXES, paletteKey, PREVIEW_COLORS, rewriteColors, type ColorOrigins, type PaletteMax } from '@/lib/picker-settings';
import { PreviewShell } from './preview-shell';

const STRINGS = DOCS_UI.palettePreview;

/**
 * The Preview of the color palette's page on the shared shell: the live palette, the array its
 * `onChange` gives, the controls of `max`, the format and opacity, and the code they make. A Max
 * below the number of colors drops the last ones, as an owner would trim the array.
 */
export function PalettePreviewStage({ codes }: { codes: CodeTable }) {
  const [max, setMax] = useState<PaletteMax>(DEFAULT_MAX);
  const [format, setFormat] = useState<ColorFormat>('hex');
  const [alpha, setAlpha] = useState(false);
  const [colors, setColors] = useState<readonly string[]>(PREVIEW_COLORS);
  const pickMax = (next: PaletteMax) => {
    setMax(next);
    setColors(colors.slice(0, Number(next)));
  };
  const origins = useRef<ColorOrigins>([]);
  const pickFormat = (next: ColorFormat) => {
    setFormat(next);
    setColors(rewriteColors(colors, next, alpha, origins.current));
  };
  const pickAlpha = (next: boolean) => {
    setAlpha(next);
    setColors(colors.map((color) => inFormat(color, format, next)));
  };
  return (
    <PreviewShell
      className="docs-demo-open docs-palette-preview"
      stage={
        <>
          <ColorPalette colors={colors} onChange={setColors} max={Number(max)} format={format} onFormatChange={setFormat} alpha={alpha} labels={{ group: STRINGS.group }} />
          {/* Not a live region: the palette announces its own changes. */}
          <output className="docs-preview-value" aria-label={STRINGS.value} aria-live="off">
            {`[${colors.map((color) => `"${color}"`).join(', ')}]`}
          </output>
        </>
      }
      settings={STRINGS.settings}
      controls={
        <>
          <Segmented legend={STRINGS.max} options={PALETTE_MAXES} value={max} onChange={pickMax} />
          <Segmented legend={STRINGS.format} options={FORMATS} value={format} onChange={pickFormat} />
          <Segmented legend={STRINGS.opacity} options={OPACITIES} value={alpha ? 'on' : 'off'} onChange={(next) => pickAlpha(next === 'on')} />
        </>
      }
      codeTitle={STRINGS.codeTitle}
      code={tableCode(codes, paletteKey({ max, format, alpha }))}
    />
  );
}
