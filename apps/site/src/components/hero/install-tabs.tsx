'use client';

import { CopyCommand } from '@/components/site/copy-command';
import { Tabs } from '@/components/site/tabs';
import { INSTALL_COMMAND, SHADCN_COMMAND } from '@/lib/site';

const TABS = [
  { id: 'npm', label: 'npm', content: <CopyCommand command={INSTALL_COMMAND} /> },
  { id: 'shadcn', label: 'shadcn', content: <CopyCommand command={SHADCN_COMMAND} /> },
] as const;

/** Install command with npm / shadcn tabs. */
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
