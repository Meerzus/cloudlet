import type { Metadata } from 'next';
import { KitHero } from '@/components/kit/kit-hero';
import { KIT_CHAPTERS } from '@/components/kit/kit-shell';
import { PickerChapter } from '@/components/kit/picker-chapter';
import { ToasterScene } from '@/components/kit/toaster-scene';
import { Chapters } from '@/components/site/chapters';
import { Footer } from '@/components/site/footer';
import { KIT_PATH, SITE_URL } from '@/lib/site';

/* Title, description and the card come from the root layout: they are the kit's. */
export const metadata: Metadata = { alternates: { canonical: `${SITE_URL}${KIT_PATH}` } };

export default function KitHome() {
  return (
    <>
      <main>
        <KitHero />
        <ToasterScene />
        <PickerChapter />
      </main>
      <Chapters chapters={KIT_CHAPTERS} />
      <Footer />
    </>
  );
}
