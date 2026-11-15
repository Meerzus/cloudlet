import { Star } from 'lucide-react';
import { GITHUB_URL } from '@/lib/site';
import { formatStars } from '@/lib/stars';
import { Button } from '@/components/ui/button';
import { ExternalLink } from './external-link';

/**
 * Star on GitHub: the star and “Star”, the whole “Star on GitHub” from `lg`, the star alone on
 * phones. The count (from the build) appears from 100 stars; the accessible name always carries the
 * visible words and the count.
 */
export function StarButton({ stars }: { stars: number | undefined }) {
  const count = formatStars(stars);
  return (
    <Button asChild variant="ghost" size="sm" className="max-sm:size-9 max-sm:px-0">
      <ExternalLink href={GITHUB_URL} aria-label={count ? `Star on GitHub, ${count} stars` : 'Star on GitHub'}>
        <Star className="size-4" aria-hidden="true" />
        <span className="max-sm:hidden" aria-hidden="true">
          Star<span className="max-lg:hidden"> on GitHub</span>
        </span>
        {count && (
          <span aria-hidden="true" className="tabular-nums text-muted-foreground max-sm:hidden">
            {count}
          </span>
        )}
      </ExternalLink>
    </Button>
  );
}
