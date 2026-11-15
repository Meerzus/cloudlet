import type { ReactNode } from 'react';
import { DocsShell } from '@/components/docs/shell';
import { Header } from '@/components/site/header';
import { MotionProvider } from '@/components/site/motion';
import { Notifications } from '@/components/site/notifications';
import { source } from '@/lib/docs-source';

/**
 * The kit's documentation: the shared header and the quiet docs shell, no sky. The page-level
 * Toaster (Notifications) is here because the Toaster's demo blocks show through its controller.
 */
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <MotionProvider>
      <Notifications>
        <Header />
        <DocsShell tree={source.getPageTree()}>{children}</DocsShell>
      </Notifications>
    </MotionProvider>
  );
}
