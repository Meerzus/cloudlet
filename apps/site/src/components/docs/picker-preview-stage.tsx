'use client';

import { useState } from 'react';
import { Segmented } from '@/components/site/segmented';
import { ColorPicker, ColorPickerPanel, type ColorFormat } from '@/components/ui/color-picker/color-picker';
import { tableCode, type CodeTable } from '@/lib/code-table';
import { DOCS_UI } from '@/lib/docs-ui-strings';
import { FORMATS, inFormat, OPACITIES, PICKER_COMPONENTS, PICKER_KINDS, pickerKey, PREVIEW_COLOR, type PickerKind } from '@/lib/picker-settings';
import { PreviewShell } from './preview-shell';

const STRINGS = DOCS_UI.pickerPreview;

/**
 * The Preview of the color picker's page on the shared shell: the live picker as a swatch or an
 * inline panel, the value its `onChange` gives, the controls of its main props and the code they
 * make. Format is the picker's own format, so the reader's choice in the picker's switch moves the
 * control too; changing it from the control rewrites the value, as the picker does on a switch.
 */
export function PickerPreviewStage({ codes }: { codes: CodeTable }) {
  const [kind, setKind] = useState<PickerKind>('swatch');
  const [format, setFormat] = useState<ColorFormat>('hex');
  const [alpha, setAlpha] = useState(false);
  const [color, setColor] = useState(PREVIEW_COLOR);
  const pickFormat = (next: ColorFormat) => {
    setFormat(next);
    setColor(inFormat(color, next, alpha));
  };
  const pickAlpha = (next: boolean) => {
    setAlpha(next);
    // Without the slider the picker drops opacity from its output: the value follows at once.
    setColor(inFormat(color, format, next));
  };
  const props = { color, onChange: setColor, format, onFormatChange: setFormat, alpha };
  return (
    <PreviewShell
      className="docs-demo-open docs-picker-preview"
      stage={
        <>
          {kind === 'swatch' ? <ColorPicker {...props} labels={{ open: STRINGS.open, panel: STRINGS.panel }} /> : <ColorPickerPanel {...props} labels={{ value: STRINGS.field }} />}
          {/* Not a live region: the picker announces its own changes. */}
          <output className="docs-preview-value" aria-label={STRINGS.value} aria-live="off">
            {color}
          </output>
        </>
      }
      settings={STRINGS.settings}
      controls={
        <>
          <Segmented legend={STRINGS.component} options={PICKER_KINDS} value={kind} onChange={setKind} />
          <Segmented legend={STRINGS.format} options={FORMATS} value={format} onChange={pickFormat} />
          <Segmented legend={STRINGS.opacity} options={OPACITIES} value={alpha ? 'on' : 'off'} onChange={(next) => pickAlpha(next === 'on')} />
        </>
      }
      codeTitle={PICKER_COMPONENTS[kind]}
      code={tableCode(codes, pickerKey({ kind, format, alpha }))}
    />
  );
}
