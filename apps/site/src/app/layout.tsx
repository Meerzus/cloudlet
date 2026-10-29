import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import '@cloudlet/toast/styles.css';
import './globals.css';
import { INDEXABLE, METADATA_BASE, TOASTER_PATH } from '@/lib/site';
import { THEME_INIT_SCRIPT } from '@/lib/theme';

/* Inter's opsz axis switches headlines to its Display cut automatically. */
const inter = Inter({ subsets: ['latin'], axes: ['opsz'], variable: '--font-inter', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

const TITLE = 'Cloudlet — notifications, light as a cloud';
const DESCRIPTION =
  'A React notification stack that drifts in, stacks softly and opens into a card when it matters. Every motion on springs, every frame interruptible.';

/* Icons and the OG/Twitter card are files next to this layout (scripts/brand-images.mjs renders the PNGs). */
export const metadata: Metadata = {
  metadataBase: new URL(METADATA_BASE),
  title: TITLE,
  description: DESCRIPTION,
  robots: INDEXABLE ? undefined : { index: false, follow: false },
  openGraph: { type: 'website', siteName: 'Cloudlet', title: TITLE, description: DESCRIPTION, url: TOASTER_PATH },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#4c94db' },
    { media: '(prefers-color-scheme: dark)', color: '#0a1022' },
  ],
};

/**
 * Shared document shell. The site chrome (sky, header, Lenis, page Toaster) lives in
 * the (site) group so the hero's `/frame` screen gets a bare document of its own.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${geistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
