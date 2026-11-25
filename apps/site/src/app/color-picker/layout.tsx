import type { ReactNode } from 'react';
import { Header } from '@/components/site/header';
import { MotionProvider } from '@/components/site/motion';
import { Notifications } from '@/components/site/notifications';

/** The color picker's corner of the site: the shared header and footer, no Toaster sky (its hero paints its own). */
export default function ColorPickerLayout({ children }: { children: ReactNode }) {
  return (
    <MotionProvider>
      <Notifications>
        <div className="cp-site">
          <Header />
          {children}
        </div>
      </Notifications>
    </MotionProvider>
  );
}
