import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ChapterList } from '@/components/site/chapters';
import { COMPONENTS } from '@/lib/site';

/** The kit landing's chapters, in page order. */
export const KIT_CHAPTERS: ChapterList = [
  { id: 'hero', label: 'Intro' },
  { id: 'components', label: 'Components' },
];

const LINK =
  'rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60';

/** Every component of the kit, in the kit's order, each leading to its landing and its docs. */
export function KitComponents() {
  return (
    <section id="components" aria-labelledby="kit-components-title" className="px-4 sm:px-6">
      <div className="mx-auto max-w-6xl pt-8 pb-24 sm:pb-32">
        <h2 id="kit-components-title" className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
          Components
        </h2>
        <ul className="mt-8 divide-y divide-foreground/10 border-y border-foreground/10">
          {COMPONENTS.map((component) => (
            <li key={component.id} className="flex flex-col gap-3 py-6 sm:flex-row sm:items-baseline sm:justify-between sm:gap-8">
              <div className="min-w-0">
                <h3 className="text-xl font-semibold tracking-[-0.02em]">{component.name}</h3>
                <p className="mt-1 text-pretty text-muted-foreground">{component.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-6 text-sm font-medium">
                <Link href={component.path} className={`${LINK} inline-flex items-center gap-1.5 text-foreground`}>
                  Open {component.name}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
                <Link href={component.docs} className={`${LINK} text-muted-foreground hover:text-foreground`} aria-label={`${component.name} docs`}>
                  Docs
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
