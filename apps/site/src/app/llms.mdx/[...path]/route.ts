import { notFound } from 'next/navigation';
import { markdownPages, pageMarkdown } from '@/lib/docs-markdown';

/**
 * The Markdown of each page at `/llms.mdx/toaster/docs/<slug>.md`. A route cannot sit
 * next to the `/toaster/docs/[[...slug]]` pages, so the export writes the files here and
 * `scripts/llms-output.mjs` moves them to `/toaster/docs/<slug>.md` (and `/toaster/docs.md` for the index,
 * `/color-picker/docs.md` for the color picker) after `next build`.
 */
export const revalidate = false;
export const dynamicParams = false;

const byPath = markdownPages;

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const page = byPath().get((await params).path.join('/'));
  if (!page) notFound();
  return new Response(await pageMarkdown(page), { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
}

export function generateStaticParams() {
  return [...byPath().keys()].map((path) => ({ path: path.split('/') }));
}
