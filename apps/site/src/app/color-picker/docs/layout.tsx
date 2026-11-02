import type { ReactNode } from 'react';
import { DocsShell } from '@/components/docs/shell';
import { pickerSource } from '@/lib/picker-docs-source';

export default function ColorPickerDocsLayout({ children }: { children: ReactNode }) {
  return <DocsShell tree={pickerSource.getPageTree()}>{children}</DocsShell>;
}
