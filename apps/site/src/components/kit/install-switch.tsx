'use client';

import { useState } from 'react';
import { CopyCommand } from '@/components/site/copy-command';
import { Segmented } from '@/components/site/segmented';
import { COMPONENTS, registryCommand, type RegistryItem } from '@/lib/site';

/**
 * The kit's install command with a switch of its components, Toaster first: the switch follows
 * COMPONENTS, so a new component is one more option and nothing else.
 */
export function InstallSwitch() {
  const [item, setItem] = useState<RegistryItem>(COMPONENTS[0]!.id);
  return (
    <div className="kit-install flex max-w-full flex-col items-start gap-4">
      <Segmented
        legend="Component"
        options={COMPONENTS.map((component) => ({ value: component.id, label: component.name }))}
        value={item}
        onChange={setItem}
      />
      <CopyCommand command={registryCommand(item)} className="kit-install-command" />
    </div>
  );
}
