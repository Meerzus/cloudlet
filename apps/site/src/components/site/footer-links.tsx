import Link from 'next/link';
import { COMPONENTS, DOCS_PATH, GITHUB_URL, LICENSE_URL } from '@/lib/site';
import { ExternalLink } from './external-link';
import { CloudletIcon } from './icons';

const LINK =
  'inline-flex min-h-6 items-center gap-2 rounded-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/60';
const QUIET = `${LINK} font-normal text-muted-foreground hover:text-foreground`;
/** The dot between items only where the row stays on one line: a wrapped row would start a line with it. */
const ITEM = 'md:not-first:before:mx-2 md:not-first:before:font-normal md:not-first:before:text-muted-foreground md:not-first:before:content-["·"]';

/**
 * The one line of links both footers share: Cloudlet (the kit's landing), the kit's components from
 * the model in site.ts, the docs, GitHub and the license. The wrapper sets the type size and weight;
 * on a phone the row wraps with no dots, so no line starts with one.
 */
export function FooterLinks({ idPrefix, iconClassName }: { idPrefix: string; iconClassName: string }) {
  return (
    <nav aria-label="Footer">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-0.5 md:gap-x-0">
        <li className={`flex items-center ${ITEM}`}>
          <Link href="/" className={`${LINK} hover:opacity-70`}>
            <CloudletIcon idPrefix={idPrefix} className={iconClassName} />
            Cloudlet
          </Link>
        </li>
        {COMPONENTS.map((component) => (
          <li key={component.id} className={`flex items-center ${ITEM}`}>
            <Link href={component.path} className={QUIET}>
              {component.name}
            </Link>
          </li>
        ))}
        <li className={`flex items-center ${ITEM}`}>
          <Link href={DOCS_PATH} className={QUIET}>
            Docs
          </Link>
        </li>
        <li className={`flex items-center ${ITEM}`}>
          <ExternalLink href={GITHUB_URL} className={QUIET}>
            GitHub
          </ExternalLink>
        </li>
        <li className={`flex items-center ${ITEM}`}>
          <ExternalLink href={LICENSE_URL} className={QUIET}>
            MIT License
          </ExternalLink>
        </li>
      </ul>
    </nav>
  );
}
