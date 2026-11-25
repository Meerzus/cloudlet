'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PLAIN_FADE_MS, PLAIN_LIMIT, type CompareEvent, type CompareTarget, type CompareToast } from '@/lib/compare-scene';

type Phase = 'in' | 'shown' | 'out';

export interface PlainItem {
  readonly id: string;
  readonly toast: CompareToast;
  readonly phase: Phase;
}

interface Entry {
  id: string;
  toast: CompareToast;
  phase: Phase;
  /** Dismissed while fading in: it leaves only once the fade-in has finished. */
  leaveAfterIn: boolean;
  timers: number[];
}

/**
 * An ordinary toast stack, done sensibly: a toast fades in, stays, fades out; the list is a plain
 * column, so the others take their new places at once; an animation that has started always plays
 * to its end (a dismiss during the fade-in waits for it). An update replaces the text in place.
 * The stack lives in a ref and is published to React after every change.
 */
export function usePlainStack() {
  const [items, setItems] = useState<readonly PlainItem[]>([]);
  const [said, setSaid] = useState('');
  const entries = useRef<Entry[]>([]);

  const target = useMemo<CompareTarget>(() => {
    const publish = () => setItems(entries.current.map(({ id, toast, phase }) => ({ id, toast, phase })));
    const find = (id: string) => entries.current.find((entry) => entry.id === id);
    const later = (entry: Entry, ms: number, callback: () => void) => {
      entry.timers.push(window.setTimeout(callback, ms));
    };
    const remove = (entry: Entry) => {
      for (const timer of entry.timers) window.clearTimeout(timer);
      entries.current = entries.current.filter((other) => other !== entry);
    };
    const leave = (entry: Entry) => {
      if (entry.phase !== 'shown') return;
      entry.phase = 'out';
      later(entry, PLAIN_FADE_MS, () => {
        remove(entry);
        publish();
      });
      publish();
    };
    const dismiss = (entry: Entry) => {
      if (entry.phase === 'in') entry.leaveAfterIn = true;
      else leave(entry);
    };
    const expire = (entry: Entry) => {
      const { duration } = entry.toast;
      if (duration !== null) later(entry, duration, () => dismiss(entry));
    };

    return {
      apply(event: CompareEvent) {
        switch (event.type) {
          case 'show': {
            const entry: Entry = { id: event.id, toast: event.toast, phase: 'in', leaveAfterIn: false, timers: [] };
            entries.current = [...entries.current, entry];
            // Over the limit, the oldest goes at once: no fade, the list simply drops it.
            while (entries.current.length > PLAIN_LIMIT) remove(entries.current[0]!);
            later(entry, PLAIN_FADE_MS, () => {
              entry.phase = 'shown';
              if (entry.leaveAfterIn) leave(entry);
              else publish();
            });
            expire(entry);
            setSaid(event.toast.title);
            publish();
            break;
          }
          case 'update': {
            const entry = find(event.id);
            if (!entry || entry.phase === 'out') return;
            entry.toast = event.toast;
            expire(entry);
            setSaid(event.toast.title);
            publish();
            break;
          }
          case 'dismiss': {
            const entry = find(event.id);
            if (entry) dismiss(entry);
            break;
          }
        }
      },
    };
  }, []);

  useEffect(
    () => () => {
      for (const entry of entries.current) for (const timer of entry.timers) window.clearTimeout(timer);
      entries.current = [];
    },
    [],
  );

  return { items, said, target };
}

function PlainIcon({ kind }: { kind: CompareToast['kind'] }) {
  if (kind === 'loading') return <span className="kt-plain-icon kt-plain-spinner" data-kind="loading" />;
  return (
    <span className="kt-plain-icon" data-kind={kind}>
      <svg viewBox="0 0 16 16">{kind === 'success' ? <path d="M4.5 8.5 7 11l4.5-5.5" /> : <path d="M8 7.25v4M8 4.75v.01" />}</svg>
    </span>
  );
}

/** The plain stack inside its phone's screen, at the screen's natural px; the scene announces it. */
export function PlainStack({ items }: { items: readonly PlainItem[] }) {
  return (
    <ol className="kt-plain" aria-hidden="true">
      {items.map((item) => (
        <li key={item.id} className="kt-plain-toast" data-phase={item.phase}>
          <PlainIcon kind={item.toast.kind} />
          <span className="kt-plain-title">{item.toast.title}</span>
        </li>
      ))}
    </ol>
  );
}
