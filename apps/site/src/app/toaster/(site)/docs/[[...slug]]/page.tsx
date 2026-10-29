import { findNeighbour } from 'fumadocs-core/page-tree';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/docs/mdx-components';
import { PageNav } from '@/components/docs/page-nav';
import { DesktopToc, MobileToc, TocProvider } from '@/components/docs/toc';
import { markdownUrl } from '@/lib/docs-markdown';
import { source } from '@/lib/docs-source';
import { SITE_URL } from '@/lib/site';

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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();
  const title = `${page.data.title} — Cloudlet Docs`;
  // Agents and crawlers: the canonical address and the page's own Markdown.
  return {
    title,
    description: page.data.description,
    openGraph: { title, description: page.data.description, url: page.url },
    alternates: { canonical: `${SITE_URL}${page.url}`, types: { 'text/markdown': `${SITE_URL}${markdownUrl(page)}` } },
  };
}
