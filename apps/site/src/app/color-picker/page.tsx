import type { Metadata } from 'next';
import { Keyboards } from '@/components/picker/keyboards';
import { Opacity } from '@/components/picker/opacity';
import { Palette } from '@/components/picker/palette';
import { PickerColorProvider } from '@/components/picker/picker-color';
import { PickerFaq } from '@/components/picker/picker-faq';
import { PickerGetStarted } from '@/components/picker/picker-get-started';
import { PickerHero } from '@/components/picker/picker-hero';
import { Tools } from '@/components/picker/tools';
import { Chapters, type ChapterList } from '@/components/site/chapters';
import { Footer } from '@/components/site/footer';
import { START_SCRIPT } from '@/lib/picker-start';
import { COLOR_PICKER_PATH, SITE_URL } from '@/lib/site';

const TITLE = 'Cloudlet Color Picker — pick a color, paint the page';
const DESCRIPTION =
  'A color picker for React: hex, rgb, hsl and oklch, an eyedropper and full keyboard support, and a palette of up to four colors built on it. shadcn items with no dependencies.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}${COLOR_PICKER_PATH}` },
  openGraph: { title: TITLE, description: DESCRIPTION, url: COLOR_PICKER_PATH },
  twitter: { title: TITLE, description: DESCRIPTION },
};

const CHAPTERS: ChapterList = [
  { id: 'hero', label: 'Intro' },
  { id: 'palette', label: 'Palette' },
  { id: 'opacity', label: 'Opacity' },
  { id: 'tools', label: 'Tools' },
  { id: 'keyboards', label: 'Keyboards' },
  { id: 'get-started', label: 'Get started' },
  { id: 'faq', label: 'FAQ' },
];

export default function ColorPickerHome() {
  return (
    <>
      {/* Before the hero's markup: the start color and its scene are on <html> before first paint. */}
      <script dangerouslySetInnerHTML={{ __html: START_SCRIPT }} />
      <PickerColorProvider>
        <main>
          <PickerHero />
          {/* The neutral sections carry a few percent of the picked color (picker.css). */}
          <div className="cp-tint">
            <Palette />
            <Opacity />
            <Tools />
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
