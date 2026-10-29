import { GITHUB_URL, LICENSE_URL } from '@/lib/site';
import { ExternalLink } from './external-link';
import { CloudletIcon } from './icons';

const LINK =
  'rounded-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60';

/** The one-line footer of reading pages; the landing keeps its cloud wordmark footer. */
export function FooterSlim() {
  return (
    <footer className="docs-footer">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-8 text-sm font-medium sm:px-6">
        <CloudletIcon idPrefix="footer-slim-icon" className="size-5" />
        Cloudlet
        <span className="font-normal text-muted-foreground" aria-hidden="true">
          ·
        </span>
        <ExternalLink href={LICENSE_URL} className={LINK}>
          MIT License
        </ExternalLink>
        <span className="font-normal text-muted-foreground" aria-hidden="true">
          ·
        </span>
        <ExternalLink href={GITHUB_URL} className={LINK}>
          GitHub
        </ExternalLink>
      </div>
    </footer>
  );
}
