import type { ReactNode } from 'react';
import '@/components/kit/kit.css';
import { KIT_SKY_LAYERS } from '@/components/kit/sky-layers';
import { Header } from '@/components/site/header';
import { MotionProvider } from '@/components/site/motion';
import { Notifications } from '@/components/site/notifications';
import { Sky } from '@/components/site/sky';

/** The kit's landing at the root: the Toaster's sky with the kit's clouds, the shared header, Lenis and the page's Toaster. */
export default function KitLayout({ children }: { children: ReactNode }) {
  return (
    <MotionProvider>
      <Notifications>
        <Sky layers={KIT_SKY_LAYERS} />
        <div className="kit-site">
          <Header />
          {children}
        </div>
      </Notifications>
    </MotionProvider>
  );
}
