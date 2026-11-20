'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCopy } from './notifications';

/** How long a Copy button reads Copied. */
const COPIED_MS = 1600;

/**
 * Copy with its confirmation in place: `copied` turns true after a successful copy and back after
 * a moment, for a button that reads Copy → Copied. The success is silent; a failure notifies
 * (`useCopy`).
 */
export function useCopied(): readonly [copied: boolean, copy: (text: string) => Promise<void>] {
  const write = useCopy({ toast: false });
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = useCallback(async (text: string) => setCopied(await write(text)), [write]);
  return [copied, copy];
}
