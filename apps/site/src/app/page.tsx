import type { Metadata } from 'next';
import { TOASTER_PATH } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Cloudlet',
  robots: { index: false, follow: false },
};

/**
 * The root of the umbrella (launch P01). On Vercel `vercel.json` answers `/` with a 307 to
 * `/toaster` before this file is reached; the page exists for static hosts and the local
 * recording server, where the same redirect happens in the browser.
 */
export default function Root() {
  return (
    <>
      <meta httpEquiv="refresh" content={`0; url=${TOASTER_PATH}`} />
      <main className="mx-auto max-w-6xl px-4 py-16">
        <p>
          <a href={TOASTER_PATH}>Cloudlet Toaster</a>
        </p>
      </main>
    </>
  );
}
