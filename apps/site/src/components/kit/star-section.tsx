import { Star } from 'lucide-react';
import type { CSSProperties } from 'react';
import { ExternalLink } from '@/components/site/external-link';
import { GitHubMark } from '@/components/site/icons';
import { GITHUB_URL } from '@/lib/site';
import { springEasing } from '@/lib/spring';
import { BUILD_STARS, formatStars } from '@/lib/stars';
import { InstallCommand } from './install-command';

/** Hover and press on Star: the hero's press spring. */
const PRESS = springEasing({ stiffness: 520, damping: 34 });
const PRESS_STYLE = { '--press-ease': PRESS.easing, '--press-duration': `${PRESS.duration}ms` } as CSSProperties;

/**
 * The page's last word before the footer: Star on GitHub, large, with the count from the build
 * (shown from 100 stars, as in the header), and the install command once more.
 */
export function StarSection({ stars = BUILD_STARS }: { stars?: number | undefined } = {}) {
  const count = formatStars(stars);
  return (
    <section id="star" aria-labelledby="kit-star-title" className="kit-star" style={PRESS_STYLE}>
      <h2 id="kit-star-title" className="ks-title">
        Open source, <span>MIT licensed.</span>
      </h2>
      <p className="ks-lede">The whole kit is on GitHub. A star helps the next developer find it.</p>
      <ExternalLink
        href={GITHUB_URL}
        className="ks-star kit-press"
        aria-label={count ? `Star on GitHub, ${count} stars` : 'Star on GitHub'}
      >
        <GitHubMark className="ks-star-mark" />
        <span aria-hidden="true">Star on GitHub</span>
        <span aria-hidden="true" className="ks-star-count">
          <Star className="ks-star-icon" />
          {count ? <span className="ks-star-number">{count}</span> : null}
        </span>
      </ExternalLink>
      <InstallCommand align="center" className="ks-install" />
    </section>
  );
}
