import { Star } from 'lucide-react';
import { GITHUB_URL } from '@/lib/site';
import { formatStars } from '@/lib/stars';
import { Button } from '@/components/ui/button';
import { ExternalLink } from './external-link';
import { GitHubMark } from './icons';

/**
 * Star on GitHub as two icons, the GitHub mark and a star, with no words. The count (from the
 * build) appears from 100 stars, beside the star from `sm` up; the accessible name always says
 * "Star on GitHub" and carries the count.
 */
export function StarButton({ stars }: { stars: number | undefined }) {
  const count = formatStars(stars);
  return (
    <Button asChild variant="ghost" size="sm" className="gap-1.5 max-sm:h-9 max-sm:has-[>svg]:px-2 max-[23.75rem]:gap-0.5 max-[23.75rem]:has-[>svg]:px-1.5">
      <ExternalLink href={GITHUB_URL} aria-label={count ? `Star on GitHub, ${count} stars` : 'Star on GitHub'}>
        <GitHubMark className="size-4" />
        <Star className="size-4" aria-hidden="true" />
        {count && (
          <span aria-hidden="true" className="tabular-nums text-muted-foreground max-sm:hidden">
            {count}
          </span>
        )}
      </ExternalLink>
    </Button>
  );
}
