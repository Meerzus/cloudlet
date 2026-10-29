import type { Metadata } from 'next';
import { Playground } from '@/components/playground/playground';
import { PLAYGROUND_PATH, SITE_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Playground — Cloudlet',
  description: 'Try every kind of Cloudlet notification and copy the exact call.',
  alternates: { canonical: `${SITE_URL}${PLAYGROUND_PATH}` },
};

export default function PlaygroundPage() {
  return <Playground />;
}
