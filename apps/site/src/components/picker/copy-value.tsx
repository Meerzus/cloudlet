'use client';

import { useEffect, useRef, useState } from 'react';

const COPIED_FOR = 1200;

/** Copies text to the clipboard and says so for a moment; without clipboard access nothing changes. */
export function useCopy(): { readonly copied: string | null; readonly copy: (text: string) => Promise<void> } {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return {
    copied,
    async copy(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return;
      }
      setCopied(text);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), COPIED_FOR);
    },
  };
}

/** A color value in large type with a Copy button beside it (Opacity, §8.6). */
export function CopyValue({ value }: { readonly value: string }) {
  const { copied, copy } = useCopy();
  const done = copied === value;
  return (
    <div className="cp-copy-value">
      {/* Not a live region: dragging the slider would read out every step. */}
      <span className="cp-copy-text" data-testid="copy-value">
        {value}
      </span>
      {/* The name starts with the visible word (WCAG 2.5.3) and says what is copied. */}
      <button type="button" className="cp-copy-button" onClick={() => void copy(value)} data-copied={done || undefined}>
        {done ? 'Copied' : 'Copy'} <span className="sr-only">{value}</span>
      </button>
      <span className="sr-only" aria-live="polite">
        {done ? `Copied ${value}` : ''}
      </span>
    </div>
  );
}
