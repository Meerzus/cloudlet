import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findNeighbour } from 'fumadocs-core/page-tree';
import type { Metadata, ResolvingMetadata } from 'next';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/docs/mdx-components';
import { PageNav } from '@/components/docs/page-nav';
import { DesktopToc, MobileToc, TocProvider } from '@/components/docs/toc';
import { markdownUrl } from '@/lib/docs-markdown';
import { source } from '@/lib/docs-source';
import { COLOR_PICKER_DOCS_PATH, COLOR_PICKER_PATH, SITE_URL } from '@/lib/site';

interface Props {
  params: Promise<{ slug?: string[] }>;
}

export default async function DocsPage({ params }: Props) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const { previous, next } = findNeighbour(source.getPageTree(), page.url);

  return (
    <TocProvider toc={page.data.toc}>
      <main className="docs-main">
        <article className="docs-article">
          <header className="docs-article-header">
            <h1>{page.data.title}</h1>
            {page.data.description ? <p>{page.data.description}</p> : null}
          </header>
          <MobileToc toc={page.data.toc} />
          <div className="docs-prose">
            <MDX components={getMDXComponents()} />
          </div>
          <PageNav previous={previous} next={next} />
        </article>
      </main>
      <DesktopToc toc={page.data.toc} />
    </TocProvider>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

/**
 * The color picker's page in the docs shares its landing's card (the JPEGs next to
 * `app/color-picker/page.tsx`); every other docs page keeps the root card it inherits.
 */
function pickerCard(name: 'opengraph-image' | 'twitter-image') {
  const alt = readFileSync(join(process.cwd(), `src/app/color-picker/${name}.alt.txt`), 'utf8').trim();
  return [{ url: `${COLOR_PICKER_PATH}/${name}.jpg`, type: 'image/jpeg', width: 1200, height: 630, alt }];
}

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();
  const title = `${page.data.title} — Cloudlet Docs`;
  // A page's own openGraph replaces the parent's whole, file-based image included: carry it over.
  const { openGraph, twitter } = await parent;
  const picker = page.url === COLOR_PICKER_DOCS_PATH;
  // Agents and crawlers: the canonical address and the page's own Markdown.
  return {
    title,
    description: page.data.description,
    openGraph: { title, description: page.data.description, url: page.url, images: picker ? pickerCard('opengraph-image') : (openGraph?.images ?? []) },
    // A page's twitter replaces the root's whole too: its own title and description, the card carried over.
    twitter: { card: 'summary_large_image', title, description: page.data.description, images: picker ? pickerCard('twitter-image') : (twitter?.images ?? []) },
    alternates: { canonical: `${SITE_URL}${page.url}`, types: { 'text/markdown': `${SITE_URL}${markdownUrl(page)}` } },
  };
}
