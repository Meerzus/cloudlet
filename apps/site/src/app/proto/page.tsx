import type { Metadata } from 'next';
import { Compare } from './_parts/compare';

export const metadata: Metadata = { title: 'Cloudlet hero prototypes', robots: { index: false, follow: false } };

export default function ProtoIndex() {
  return <Compare />;
}
