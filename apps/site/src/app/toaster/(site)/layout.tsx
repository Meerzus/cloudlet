import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Header } from '@/components/site/header';
import { MotionProvider } from '@/components/site/motion';
import { Notifications } from '@/components/site/notifications';
import { Sky } from '@/components/site/sky';
import { TOASTER_DESCRIPTION, TOASTER_PATH, TOASTER_TITLE } from '@/lib/site';

/* The Toaster's metadata for its landing and Playground; its OG/Twitter card is the pair of files next to this layout. */
export const metadata: Metadata = {
  title: TOASTER_TITLE,
  description: TOASTER_DESCRIPTION,
  openGraph: { type: 'website', siteName: 'Cloudlet', title: TOASTER_TITLE, description: TOASTER_DESCRIPTION, url: TOASTER_PATH },
  twitter: { card: 'summary_large_image', title: TOASTER_TITLE, description: TOASTER_DESCRIPTION },
};

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <MotionProvider>
      <Notifications>
        <Sky />
        <Header />
        {children}
      </Notifications>
    </MotionProvider>
  );
}
