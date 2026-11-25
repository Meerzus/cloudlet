import { EdgeBlur } from '@/components/site/edge-blur';
import { FooterSlim } from '@/components/site/footer-slim';

/**
 * The color picker landing's foot (COLOR_PICKER §8.8): the one-line footer without its rule, over a
 * progressive blur that softens the paint toward the page's bottom edge, as the header's does at the
 * top, with a light tint of the theme's background. The paper is lifted under its line (paint-page.tsx).
 */
export function PaintFooter() {
  return (
    <div className="cp-paint-footer">
      <EdgeBlur edge="bottom" height="min(14rem, 30svh)" strength={2} absolute>
        <div className="cp-paint-footer-tint" />
      </EdgeBlur>
      <FooterSlim />
    </div>
  );
}
