'use client';

import type { ReactNode } from 'react';
import { PackageManagerSwitch, usePackageManager } from '@/components/site/package-manager';
import type { PackageManager } from '@/lib/package-managers';

/**
 * The install command of a docs page in the reader's package manager: every variant is highlighted on
 * the server (InstallCommand in get-started-code.tsx), and the shared switch picks which one shows.
 */
export function PackageManagerCode({ variants }: { variants: Record<PackageManager, ReactNode> }) {
  const [manager] = usePackageManager();
  return (
    <div className="docs-install">
      <PackageManagerSwitch className="docs-install-switch" />
      {variants[manager]}
    </div>
  );
}
