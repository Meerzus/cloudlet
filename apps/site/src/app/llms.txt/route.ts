import { llmsIndex } from '@/lib/docs-markdown';

/** `/llms.txt` (DOCS.md §9), a static file of the export. */
export const revalidate = false;

export function GET() {
  return new Response(llmsIndex(), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
