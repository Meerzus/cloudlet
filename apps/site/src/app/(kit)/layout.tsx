import type { ReactNode } from 'react';
import '@/components/kit/kit.css';
import { Header } from '@/components/site/header';
import { MotionProvider } from '@/components/site/motion';
import { Notifications } from '@/components/site/notifications';

/** The kit's landing at the root: the shared header, Lenis and the page's Toaster; no sky yet. */
export default function KitLayout({ children }: { children: ReactNode }) {
  return (
    <MotionProvider>
      <Notifications>
        <div className="kit-site">
          <Header />
          {children}
        </div>
      </Notifications>
    </MotionProvider>
  );
}
