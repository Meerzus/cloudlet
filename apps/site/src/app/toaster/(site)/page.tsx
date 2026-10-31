import type { Metadata } from 'next';
import { DriftScene } from '@/components/drift/drift-scene';
import { Faq } from '@/components/faq/faq';
import { GetStarted } from '@/components/get-started/get-started';
import { Hero } from '@/components/hero/hero';
import { LifeScene } from '@/components/life/life-scene';
import { Chapters } from '@/components/site/chapters';
import { Footer } from '@/components/site/footer';
import { SITE_URL, TOASTER_PATH } from '@/lib/site';

export const metadata: Metadata = { alternates: { canonical: `${SITE_URL}${TOASTER_PATH}` } };

export default function Home() {
  return (
    <>
      <main>
        <Hero />
        <LifeScene />
        <DriftScene />
        <GetStarted />
        <Faq />
      </main>
      <Chapters />
      <Footer />
    </>
  );
}
