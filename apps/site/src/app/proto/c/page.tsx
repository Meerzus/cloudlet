import type { Metadata } from 'next';
import { CodeHero } from '../_parts/code-hero';

export const metadata: Metadata = { title: 'Prototype C: code comes alive', robots: { index: false, follow: false } };

export default function ProtoC() {
  return (
    <main className="proto-c">
      <CodeHero />
    </main>
  );
}
