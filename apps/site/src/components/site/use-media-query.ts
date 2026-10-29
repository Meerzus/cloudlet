'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** `null` on the server and during hydration, then the live match. */
export function useMediaQuery(query: string): boolean | null {
  const subscribe = useCallback(
    (listener: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => null,
  );
}
