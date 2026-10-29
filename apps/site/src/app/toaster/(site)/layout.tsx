import type { ReactNode } from 'react';
import { Header } from '@/components/site/header';
import { MotionProvider } from '@/components/site/motion';
import { Notifications } from '@/components/site/notifications';
import { Sky } from '@/components/site/sky';

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
