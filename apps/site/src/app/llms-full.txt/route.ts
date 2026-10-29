import { llmsFull } from '@/lib/docs-markdown';

/** `/llms-full.txt` (DOCS.md §9), a static file of the export. */
export const revalidate = false;

export async function GET() {
  return new Response(await llmsFull(), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
