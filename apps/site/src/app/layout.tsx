import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import '@cloudlet/toast/styles.css';
import './globals.css';
import '@/components/site/scene-transition.css';
import { INDEXABLE, KIT_DESCRIPTION, KIT_PATH, KIT_TITLE, METADATA_BASE } from '@/lib/site';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import { SceneStage } from '@/components/site/scene-transition';

/* Inter's opsz axis switches headlines to its Display cut automatically. */
const inter = Inter({ subsets: ['latin'], axes: ['opsz'], variable: '--font-inter', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

/*
 * The kit's metadata, which every page without its own inherits. Icons and the OG/Twitter card are
 * files next to this layout: the card is the kit's (scripts/og-kit.mjs), the icons come from
 * scripts/brand-images.mjs.
 */
export const metadata: Metadata = {
  metadataBase: new URL(METADATA_BASE),
  title: KIT_TITLE,
  description: KIT_DESCRIPTION,
  robots: INDEXABLE ? undefined : { index: false, follow: false },
  openGraph: { type: 'website', siteName: 'Cloudlet', title: KIT_TITLE, description: KIT_DESCRIPTION, url: KIT_PATH },
  twitter: { card: 'summary_large_image', title: KIT_TITLE, description: KIT_DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#4c94db' },
    { media: '(prefers-color-scheme: dark)', color: '#0a1022' },
  ],
};

/**
 * Shared document shell. The site chrome (sky, header, Lenis, page Toaster) lives in each section's
 * own layout — the kit's (kit) group, the Toaster's (site) group, the color picker, the docs — so the
 * Toaster hero's `/toaster/frame` screen gets a bare document of its own.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${geistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <SceneStage>{children}</SceneStage>
      </body>
    </html>
  );
}
