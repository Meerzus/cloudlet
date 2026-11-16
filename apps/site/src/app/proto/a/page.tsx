import type { Metadata } from 'next';
import { PaintPage } from '@/components/picker/paint-page';
import { PickerColorProvider } from '@/components/picker/picker-color';
import { StartColorScript } from '@/components/picker/start-color-script';
import { KitAtWork } from '../_parts/kit-at-work';

export const metadata: Metadata = { title: 'Prototype A: kit at work', robots: { index: false, follow: false } };

export default function ProtoA() {
  return (
    <>
      <StartColorScript />
      <PickerColorProvider>
        <main className="proto-a">
          <KitAtWork />
        </main>
        <PaintPage />
      </PickerColorProvider>
    </>
  );
}
