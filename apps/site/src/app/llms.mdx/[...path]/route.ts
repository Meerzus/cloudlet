import { notFound } from 'next/navigation';
import { markdownUrl, pageMarkdown } from '@/lib/docs-markdown';
import { source } from '@/lib/docs-source';

/**
 * The Markdown of each page (DOCS.md §9) at `/llms.mdx/toaster/docs/<slug>.md`. A route cannot sit
 * next to the `/toaster/docs/[[...slug]]` pages, so the export writes the files here and
 * `scripts/llms-output.mjs` moves them to `/toaster/docs/<slug>.md` (and `/toaster/docs.md` for the index)
 * after `next build`.
 */
export const revalidate = false;
export const dynamicParams = false;

const byPath = () => new Map(source.getPages().map((page) => [markdownUrl(page).slice(1), page]));

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const page = byPath().get((await params).path.join('/'));
  if (!page) notFound();
  return new Response(await pageMarkdown(page), { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
}

export function generateStaticParams() {
  return [...byPath().keys()].map((path) => ({ path: path.split('/') }));
}
