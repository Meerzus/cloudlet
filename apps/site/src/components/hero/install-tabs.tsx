'use client';

import { PackageManagerCommand } from '@/components/site/package-manager';
import { Tabs } from '@/components/site/tabs';
import { INSTALL_COMMAND, SHADCN_COMMAND } from '@/lib/site';

const TABS = [
  { id: 'npm', label: 'npm', content: <PackageManagerCommand command={INSTALL_COMMAND} className="items-center" /> },
  { id: 'shadcn', label: 'shadcn', content: <PackageManagerCommand command={SHADCN_COMMAND} className="items-center" /> },
] as const;

/** Install command with npm / shadcn tabs, each in the reader's package manager. */
export function InstallTabs() {
  return (
    <Tabs
      label="Install with"
      items={TABS}
      className="flex w-full max-w-md flex-col items-center gap-3"
      panelClassName="flex w-full justify-center"
    />
  );
}
