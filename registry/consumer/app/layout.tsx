import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'Cloudlet local registry verification', robots: { index: false, follow: false } };

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
