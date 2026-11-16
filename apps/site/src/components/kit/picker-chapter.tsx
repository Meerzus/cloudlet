import { PaintSection } from '@/components/picker/paint-section';
import { PickerColorProvider } from '@/components/picker/picker-color';
import { ColorCompare } from './color-compare';

/** The chapter's copy that gets the paint's paper under its lines; the sheets of the comparisons draw their own. */
const CALM = '.kit-picker-copy :is(h2, h3, p, a, figcaption, .kc-try-label)';

/**
 * The color picker and the palette's chapter, under the Toaster's: the sky runs into the color
 * picker landing's paint at its top and out of it again at its bottom, and the two comparisons sit
 * on the paint — the chapter's color and palette repaint it. The chapter keeps its color to itself
 * (no `?c=` on the kit's page); the islands of the hero have their own.
 */
export function PickerChapter() {
  return (
    <PickerColorProvider page={false}>
      <section id="color-picker" aria-labelledby="kit-picker-title" className="kit-picker">
        <PaintSection calm={CALM} />
        <div className="kit-picker-copy">
          <div className="kit-picker-intro">
            <p className="kit-eyebrow">Color picker &amp; Color palette</p>
            <h2 id="kit-picker-title" className="kit-picker-title" data-paint-origin="">
              Same color. <span>Better in hand.</span>
            </h2>
            <p className="kit-picker-lede">
              Each pair below holds one color, or one palette, on two identical sheets: the browser’s own inputs and the
              kit’s. Whatever you set there paints this chapter.
            </p>
          </div>
          <ColorCompare />
        </div>
      </section>
    </PickerColorProvider>
  );
}
