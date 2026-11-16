import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { PaintSection } from '@/components/picker/paint-section';
import { PickerColorProvider } from '@/components/picker/picker-color';
import { COLOR_PALETTE_PATH, COLOR_PICKER_PATH } from '@/lib/site';

/** The chapter's copy that gets the paint's paper under its lines. */
const CALM = '.kit-picker-copy :is(p, h2, a)';

/**
 * The color picker and the palette's chapter, under the Toaster's: the sky runs into the color
 * picker landing's paint at its top and out of it again at its bottom. The chapter keeps its color to
 * itself (no `?c=` on the kit's page); the islands of the hero have their own.
 */
export function PickerChapter() {
  return (
    <PickerColorProvider page={false}>
      <section id="color-picker" aria-labelledby="kit-picker-title" className="kit-picker">
        <PaintSection calm={CALM} />
        <div className="kit-picker-copy">
          <p className="kit-eyebrow">Color picker &amp; palette</p>
          <h2 id="kit-picker-title" className="kit-picker-title" data-paint-origin="">
            Pick a color. <span>Paint the page.</span>
          </h2>
          <p className="kit-picker-lede">
            A picker for hex, rgb, hsl and oklch with an eyedropper and every key you expect, and a palette of up to four
            colors built on it. This whole chapter is painted with them.
          </p>
          <div className="kit-picker-links">
            <Link href={COLOR_PICKER_PATH} className="kit-open">
              Open Color picker
              <ArrowRight className="kit-open-arrow" aria-hidden="true" />
            </Link>
            <Link href={COLOR_PALETTE_PATH} className="kit-open">
              Open Color palette
              <ArrowRight className="kit-open-arrow" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </PickerColorProvider>
  );
}
