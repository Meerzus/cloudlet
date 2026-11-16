import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Header } from '@/components/site/header';
import { MotionProvider } from '@/components/site/motion';
import { Notifications } from '@/components/site/notifications';
import './proto.css';

/** Hero studies for the kit's landing: local only in spirit, never indexed, not in the sitemap. */
export const metadata: Metadata = {
  title: 'Cloudlet hero prototypes',
  robots: { index: false, follow: false },
};

export default function ProtoLayout({ children }: { children: ReactNode }) {
  return (
    <MotionProvider>
      <Notifications>
        <Header />
        {children}
      </Notifications>
    </MotionProvider>
  );
}
