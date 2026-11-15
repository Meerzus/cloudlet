import type { Metadata, ResolvingMetadata } from 'next';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/docs/mdx-components';
import { DesktopToc, MobileToc, TocProvider } from '@/components/docs/toc';
import { markdownUrl } from '@/lib/docs-markdown';
import { pickerSource } from '@/lib/picker-docs-source';
import { SITE_URL } from '@/lib/site';

/** The color picker's one documentation page (COLOR_PICKER §9), laid out like the Toaster's docs pages. */
const page = () => pickerSource.getPage([]) ?? notFound();

export default function ColorPickerDocs() {
  const { data } = page();
  const MDX = data.body;
  return (
    <TocProvider toc={data.toc}>
      <main className="docs-main">
        <article className="docs-article">
          <header className="docs-article-header">
            <h1>{data.title}</h1>
            {data.description ? <p>{data.description}</p> : null}
          </header>
          <MobileToc toc={data.toc} />
          <div className="docs-prose">
            <MDX components={getMDXComponents()} />
          </div>
        </article>
      </main>
      <DesktopToc toc={data.toc} />
    </TocProvider>
  );
}

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const current = page();
  const title = `${current.data.title} — Cloudlet Docs`;
  // A page's own openGraph replaces the parent's whole, file-based image included: carry it over.
  const { openGraph } = await parent;
  return {
    title,
    description: current.data.description,
    openGraph: { title, description: current.data.description, url: current.url, images: openGraph?.images ?? [] },
    alternates: { canonical: `${SITE_URL}${current.url}`, types: { 'text/markdown': `${SITE_URL}${markdownUrl(current)}` } },
  };
}
