'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCopy } from '@/components/site/notifications';
import { SEGMENT_STYLE, useSegmentIndicator } from '@/components/site/use-segment-indicator';
import { COMPONENTS, REGISTRY_NAMESPACE, registryCommand, type RegistryItem } from '@/lib/site';
import { cn } from '@/lib/utils';

/** How long the copy button shows its check after a copy. */
const COPIED_FOR = 1600;

export interface InstallCommandProps {
  /** The component the command installs first; Toaster unless a scene installs its own. */
  readonly initial?: RegistryItem;
  /** The switch of the kit's components above the command; off, the command stays on `initial`. */
  readonly switcher?: boolean;
  /** `center` centers the switch over the command (the hero); `start` lines both up on the left. */
  readonly align?: 'start' | 'center';
  readonly className?: string;
}

/**
 * The kit's install command, `npx shadcn@latest add @cloudlet/<item>`, with a switch of its
 * components. The switch follows COMPONENTS, so a new component is one more segment and nothing
 * else. A press copies the command and the page's Toaster confirms; the item's name and the copy
 * icon change by blur. On a phone the command wraps at its spaces instead of being cut.
 */
export function InstallCommand({ initial = 'toaster', switcher = true, align = 'start', className }: InstallCommandProps) {
  const [item, setItem] = useState<RegistryItem>(initial);
  const [copied, setCopied] = useState(false);
  // The item's name comes in by blur only after a switch, not on the first render.
  const [switched, setSwitched] = useState(false);
  const copy = useCopy();
  const segments = useSegmentIndicator(COMPONENTS.findIndex((component) => component.id === item));
  const command = registryCommand(item);
  const prefix = command.slice(0, command.length - `${REGISTRY_NAMESPACE}/${item}`.length);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FOR);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className={cn('kit-install', align === 'center' && 'kit-install-center', className)}>
      {switcher ? (
        <div ref={segments.group} role="group" aria-label="Component to install" className="kit-install-items" style={SEGMENT_STYLE}>
          <span ref={segments.indicator} aria-hidden="true" className="segment-indicator kit-install-indicator" />
          {COMPONENTS.map((component) => (
            <button
              key={component.id}
              type="button"
              data-segment=""
              aria-pressed={component.id === item}
              onClick={() => {
                setItem(component.id);
                setSwitched(true);
              }}
            >
              {component.name}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="kit-install-command"
        data-copied={copied ? '' : undefined}
        onClick={async () => setCopied(await copy(command))}
        aria-label={`Copy command: ${command}`}
      >
        <span aria-hidden="true" className="kit-install-prompt">
          $
        </span>
        <span aria-hidden="true" className="kit-install-text">
          {prefix}
          <span key={item} className={cn('kit-install-item', switched && 'kit-swap')}>{`${REGISTRY_NAMESPACE}/${item}`}</span>
        </span>
        <span aria-hidden="true" className="kit-install-copy">
          <Copy className="kit-install-icon" data-icon="copy" />
          <Check className="kit-install-icon" data-icon="check" />
        </span>
      </button>
    </div>
  );
}
