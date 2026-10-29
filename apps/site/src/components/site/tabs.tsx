'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SEGMENT_STYLE, useSegmentIndicator } from './use-segment-indicator';

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
}

/** WAI-ARIA tabs with automatic activation: ← / → / Home / End move and select. */
export function Tabs({
  label,
  items,
  className,
  panelClassName,
}: {
  label: string;
  items: readonly TabItem[];
  className?: string;
  panelClassName?: string;
}) {
  const [selected, setSelected] = useState(0);
  const base = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const { group, indicator } = useSegmentIndicator(selected);

  const onKeyDown = (event: KeyboardEvent) => {
    const last = items.length - 1;
    const next =
      event.key === 'ArrowRight' ? (selected === last ? 0 : selected + 1)
      : event.key === 'ArrowLeft' ? (selected === 0 ? last : selected - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
  };

  const active = items[selected] ?? items[0]!;
  return (
    <div className={className}>
      <div
        ref={group}
        role="tablist"
        aria-label={label}
        style={SEGMENT_STYLE}
        className="relative flex w-fit rounded-full border border-glass-border bg-background/40 p-1 backdrop-blur-md"
        onKeyDown={onKeyDown}
      >
        <span ref={indicator} aria-hidden="true" className="segment-indicator inset-y-1 bg-foreground" />
        {items.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            type="button"
            role="tab"
            data-segment=""
            id={`${base}-${tab.id}`}
            aria-selected={index === selected}
            aria-controls={`${base}-panel`}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => setSelected(index)}
            className={cn(
              'relative h-8 rounded-full px-4 font-mono text-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/60',
              index === selected ? 'text-background' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${active.id}`} className={panelClassName}>
        {active.content}
      </div>
    </div>
  );
}
