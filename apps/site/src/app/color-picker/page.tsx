import type { Metadata } from 'next';
import { Keyboards } from '@/components/picker/keyboards';
import { Opacity } from '@/components/picker/opacity';
import { PaintFooter } from '@/components/picker/paint-footer';
import { PaintPage } from '@/components/picker/paint-page';
import { Palette } from '@/components/picker/palette';
import { PickerColorProvider } from '@/components/picker/picker-color';
import { PickerFaq } from '@/components/picker/picker-faq';
import { PickerGetStarted } from '@/components/picker/picker-get-started';
import { PickerHero } from '@/components/picker/picker-hero';
import { StartColorScript } from '@/components/picker/start-color-script';
import { Tools } from '@/components/picker/tools';
import { Chapters, type ChapterList } from '@/components/site/chapters';
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
      {/* Before the page's markup: the start color is on <html> before first paint. */}
      <StartColorScript />
      <PickerColorProvider>
        <main>
          <PickerHero />
          <Palette />
          <Opacity />
          <Tools />
          <Keyboards />
          <PickerGetStarted />
          <PickerFaq />
        </main>
        {/* One picture under the whole page: the hero is its top (§8.2). */}
        <PaintPage />
      </PickerColorProvider>
      <Chapters chapters={CHAPTERS} />
      <PaintFooter />
    </>
  );
}
