'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCopy } from '@/components/site/notifications';
import { SEGMENT_STYLE, useSegmentIndicator } from '@/components/site/use-segment-indicator';
import { COMPONENTS, REGISTRY_NAMESPACE, type RegistryItem } from '@/lib/site';
import { cn } from '@/lib/utils';

/**
 * The install command with a switch of the kit's components (Toaster by default): the list follows
 * COMPONENTS, so a new component is one more segment, nothing else.
 */
export function InstallCommand({ className, align = 'start' }: { className?: string; align?: 'start' | 'center' }) {
  const [item, setItem] = useState<RegistryItem>('toaster');
  const [copied, setCopied] = useState(false);
  const copy = useCopy();
  const active = COMPONENTS.findIndex((component) => component.id === item);
  const segments = useSegmentIndicator(active);
  const command = `npx shadcn@latest add ${REGISTRY_NAMESPACE}/${item}`;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className={cn('proto-install', align === 'center' && 'items-center', className)}>
      <div ref={segments.group} role="group" aria-label="Component to install" className="proto-install-items" style={SEGMENT_STYLE}>
        <span ref={segments.indicator} aria-hidden="true" className="segment-indicator proto-install-indicator" />
        {COMPONENTS.map((component) => (
          <button
            key={component.id}
            type="button"
            data-segment=""
            aria-pressed={component.id === item}
            onClick={() => setItem(component.id)}
          >
            {component.name}
          </button>
        ))}
      </div>
      <button type="button" className="proto-install-command" onClick={async () => setCopied(await copy(command))} aria-label={`Copy command: ${command}`}>
        <span aria-hidden="true" className="proto-install-prompt">
          $
        </span>
        <span className="proto-install-text">
          npx shadcn@latest add <span className="proto-install-item">{`${REGISTRY_NAMESPACE}/${item}`}</span>
        </span>
        <span aria-hidden="true" className="proto-install-copy">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </span>
      </button>
    </div>
  );
}
