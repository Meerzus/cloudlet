'use client';

import { useRef, useState } from 'react';
import { Segmented } from '@/components/site/segmented';
import { ColorPicker, ColorPickerPanel, type ColorFormat } from '@/components/ui/color-picker/color-picker';
import { tableCode, type CodeTable } from '@/lib/code-table';
import { DOCS_UI } from '@/lib/docs-ui-strings';
import { FORMATS, inFormat, OPACITIES, PICKER_COMPONENTS, PICKER_KINDS, pickerKey, PREVIEW_COLOR, rewriteColors, type ColorOrigins, type PickerKind } from '@/lib/picker-settings';
import { PreviewShell } from './preview-shell';
import { useHeightGlide } from './use-height-glide';

const STRINGS = DOCS_UI.pickerPreview;
/** The stage grows from the swatch to the panel and back on this spring: no overshoot to speak of, settled in about half a second. */
const STAGE_SPRING = { stiffness: 260, damping: 28 };

/**
 * The Preview of the color picker's page on the shared shell: the live picker as a swatch or an
 * inline panel, the value its `onChange` gives, the controls of its main props and the code they
 * make. Format is the picker's own format, so the reader's choice in the picker's switch moves the
 * control too; changing it from the control rewrites the value, as the picker does on a switch,
 * and a walk through the formats and back gives the color it started from.
 * The swatch and the panel differ in height: the stage glides between the two on a spring, and the
 * component that arrives comes into focus.
 */
export function PickerPreviewStage({ codes }: { codes: CodeTable }) {
  const [kind, setKind] = useState<PickerKind>('swatch');
  const [format, setFormat] = useState<ColorFormat>('hex');
  const [alpha, setAlpha] = useState(false);
  const [color, setColor] = useState(PREVIEW_COLOR);
  const { ref: stage, resize } = useHeightGlide(STAGE_SPRING);
  const origins = useRef<ColorOrigins>([]);
  const pickFormat = (next: ColorFormat) => {
    setFormat(next);
    setColor(rewriteColors([color], next, alpha, origins.current)[0] ?? color);
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
      stageRef={stage}
      stage={
        <>
          {/* Keyed by the kind, so the component that arrives plays its entrance. */}
          <div key={kind} className="docs-preview-swap">
            {kind === 'swatch' ? <ColorPicker {...props} labels={{ open: STRINGS.open, panel: STRINGS.panel }} /> : <ColorPickerPanel {...props} labels={{ value: STRINGS.field }} />}
          </div>
          {/* Not a live region: the picker announces its own changes. */}
          <output className="docs-preview-value" aria-label={STRINGS.value} aria-live="off">
            {color}
          </output>
        </>
      }
      settings={STRINGS.settings}
      controls={
        <>
          <Segmented legend={STRINGS.component} options={PICKER_KINDS} value={kind} onChange={(next) => resize(() => setKind(next))} />
          <Segmented legend={STRINGS.format} options={FORMATS} value={format} onChange={pickFormat} />
          <Segmented legend={STRINGS.opacity} options={OPACITIES} value={alpha ? 'on' : 'off'} onChange={(next) => pickAlpha(next === 'on')} />
        </>
      }
      codeTitle={PICKER_COMPONENTS[kind]}
      code={tableCode(codes, pickerKey({ kind, format, alpha }))}
    />
  );
}
