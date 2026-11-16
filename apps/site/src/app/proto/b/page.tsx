import type { Metadata } from 'next';
import { Sky } from '@/components/site/sky';
import { SkyHero } from '../_parts/sky-hero';

export const metadata: Metadata = { title: 'Prototype B: sky', robots: { index: false, follow: false } };

export default function ProtoB() {
  return (
    <>
      <Sky />
      <main className="proto-b">
        <SkyHero />
      </main>
    </>
  );
}
