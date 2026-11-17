import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { PaintSection } from '@/components/picker/paint-section';
import { DOCS_PATH } from '@/lib/site';
import { HeroParts } from './hero-parts';
import { InstallCommand } from './install-command';
import { SkyGate } from './sky-gate';
import { PRESS_STYLE, StarLink } from './star-link';

/** The hero's copy that gets the paint's paper under its lines; the controls draw their own fill. */
const CALM = '#hero :is(.kh-title, .kh-lede, .kh-label, .kh-note)';

/** Where the docs list the kit's components. */
export const BROWSE_HREF = `${DOCS_PATH}#components`;

/**
 * The top of the kit's landing: the color picker's paint across the first screen, running into the
 * sky of the Toaster's scene along a ragged airbrush edge at its bottom. On the left the words, the
 * install command with the switch of the components, Browse components and Star on GitHub; on the
 * right the kit itself — Toaster, Color picker, Color palette, live and at the same weight. The page's
 * one color (KitColor) paints it, and the color picker's chapter below in the same color.
 */
export function KitHero() {
  return (
    <section id="hero" aria-labelledby="kit-title" className="kit-hero" data-sky-clouds="off" style={PRESS_STYLE}>
      <PaintSection calm={CALM} />
      <SkyGate />
      <div className="kh-inner">
        <div className="kh-copy">
          <h1 id="kit-title" className="kh-title">
            Made to work <span>together.</span>
          </h1>
          <p className="kh-lede">A Toaster, a color picker and a palette for React. Change one color and the whole kit answers.</p>
          <InstallCommand className="kh-install" />
          <div className="kh-actions">
            <Link href={BROWSE_HREF} className="kh-browse kit-press">
              Browse components
              <ArrowRight className="kh-browse-arrow" aria-hidden="true" />
            </Link>
            <StarLink className="kh-star" />
          </div>
        </div>
        <HeroParts />
      </div>
    </section>
  );
}
