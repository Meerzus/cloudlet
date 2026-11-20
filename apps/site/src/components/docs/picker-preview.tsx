import { codeTable } from '@/lib/code-tokens';
import { paletteCodes, pickerCodes } from '@/lib/picker-settings';
import { PalettePreviewStage } from './palette-preview-stage';
import { PickerPreviewStage } from './picker-preview-stage';

/*
 * `<PickerPreview />` and `<PalettePreview />` in a page: the server halves of the two Previews.
 * Every code the controls can make is coloured here at build time, each line once, so the browser
 * switches between ready lines and nothing of Shiki ships to it.
 */

export async function PickerPreview() {
  return <PickerPreviewStage codes={await codeTable(pickerCodes())} />;
}

export async function PalettePreview() {
  return <PalettePreviewStage codes={await codeTable(paletteCodes())} />;
}
