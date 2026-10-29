'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useCopy } from './notifications';

export function CopyCommand({ command, className }: { command: string; className?: string }) {
  const copy = useCopy();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={async () => setCopied(await copy(command))}
      aria-label={`Copy command: ${command}`}
      className={cn(
        'group inline-flex h-12 max-w-full items-center gap-3 rounded-full border border-glass-border bg-background/55 pl-5 pr-2 font-mono text-sm shadow-sm backdrop-blur-md outline-none transition-colors hover:bg-background/75 focus-visible:ring-[3px] focus-visible:ring-ring/60',
        className,
      )}
    >
      <span aria-hidden="true" className="select-none text-muted-foreground">$</span>
      <span className="truncate">{command}</span>
      <span className="grid size-8 place-items-center rounded-full bg-foreground/5 text-muted-foreground group-hover:text-foreground">
        {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
      </span>
    </button>
  );
}
