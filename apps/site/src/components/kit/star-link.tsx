import { Star } from 'lucide-react';
import type { CSSProperties } from 'react';
import { ExternalLink } from '@/components/site/external-link';
import { GitHubMark } from '@/components/site/icons';
import { GITHUB_URL } from '@/lib/site';
import { springEasing } from '@/lib/spring';
import { BUILD_STARS, formatStars } from '@/lib/stars';
import { cn } from '@/lib/utils';

/** Hover and press on the kit's buttons: quick, with a hint of give. */
const PRESS = springEasing({ stiffness: 520, damping: 34 });
/** The press spring as the variables `.kit-press` reads: set on the section that holds the buttons. */
export const PRESS_STYLE = { '--press-ease': PRESS.easing, '--press-duration': `${PRESS.duration}ms` } as CSSProperties;

/**
 * Star on GitHub as the kit's landing draws it: the GitHub mark, the words, and a star with the count
 * from the build in a capsule — the number only from 100 stars, as in the header. The hero has it under
 * the command, the last section large (`className` sizes it).
 */
export function StarLink({ stars = BUILD_STARS, className }: { stars?: number | undefined; className?: string }) {
  const count = formatStars(stars);
  return (
    <ExternalLink href={GITHUB_URL} className={cn('ks-star kit-press', className)} aria-label={count ? `Star on GitHub, ${count} stars` : 'Star on GitHub'}>
      <GitHubMark className="ks-star-mark" />
      <span aria-hidden="true">
        Star<span className="kh-star-long"> on GitHub</span>
      </span>
      <span aria-hidden="true" className="ks-star-count">
        <Star className="ks-star-icon" />
        {count ? <span className="ks-star-number">{count}</span> : null}
      </span>
    </ExternalLink>
  );
}
