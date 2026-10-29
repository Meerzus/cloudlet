import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import '@cloudlet/toast/styles.css';
import '../consumer.css';
export default async function Layout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? '';
  return <html lang="en"><head><script nonce={nonce} src="/audit.js" /></head><body>{children}</body></html>;
}
