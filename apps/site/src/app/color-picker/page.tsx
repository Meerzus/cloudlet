import type { Metadata } from 'next';
import { Combinations } from '@/components/picker/combinations';
import { Keyboards } from '@/components/picker/keyboards';
import { PickerColorProvider } from '@/components/picker/picker-color';
import { PickerFaq } from '@/components/picker/picker-faq';
import { PickerGetStarted } from '@/components/picker/picker-get-started';
import { PickerHero } from '@/components/picker/picker-hero';
import { Chapters, type ChapterList } from '@/components/site/chapters';
import { Footer } from '@/components/site/footer';
import { START_SCRIPT } from '@/lib/landscape';
import { COLOR_PICKER_PATH, SITE_URL } from '@/lib/site';

const TITLE = 'Cloudlet Color Picker — a swatch that opens into a picker';
const DESCRIPTION =
  'A color picker for React and shadcn: a round swatch that morphs into hex, rgb, hsl and oklch, opacity, the eyedropper and the keyboard. One registry item, no dependencies.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}${COLOR_PICKER_PATH}` },
  openGraph: { title: TITLE, description: DESCRIPTION, url: COLOR_PICKER_PATH },
  twitter: { title: TITLE, description: DESCRIPTION },
};

const CHAPTERS: ChapterList = [
  { id: 'hero', label: 'Intro' },
  { id: 'combinations', label: 'Combinations' },
  { id: 'keyboards', label: 'Built for keyboards' },
  { id: 'get-started', label: 'Get started' },
  { id: 'faq', label: 'FAQ' },
];

export default function ColorPickerHome() {
  return (
    <>
      {/* Before the hero's markup: the start color and its hour are on <html> before first paint. */}
      <script dangerouslySetInnerHTML={{ __html: START_SCRIPT }} />
      <PickerColorProvider>
        <main>
          <PickerHero />
          {/* The neutral sections carry a few percent of the picked color (picker.css). */}
          <div className="cp-tint">
            <Combinations />
            <Keyboards />
            <PickerGetStarted />
            <PickerFaq />
          </div>
        </main>
      </PickerColorProvider>
      <Chapters chapters={CHAPTERS} />
      <Footer />
    </>
  );
}
