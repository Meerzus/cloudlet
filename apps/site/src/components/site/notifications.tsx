'use client';

import {
  CloudletProvider,
  createCloudlet,
  Toaster,
  useOptionalCloudlet,
  type ReactCloudletController,
} from '@cloudlet/toast';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useTheme } from './theme';

/** Live Toaster options a page may set (the playground); null = site defaults. */
export interface ToasterSettings {
  readonly position: 'auto' | 'top-center' | 'bottom-center';
  readonly dir: 'ltr' | 'rtl';
}

const ToasterSettingsContext = createContext<(settings: ToasterSettings | null) => void>(() => {});

/**
 * Page-level client owner (registry/README.md): the effect creates the controller
 * and disposes exactly that instance, so Strict Mode replays stay correct.
 * The provider takes the controller while it is still null: children render on
 * the server and before it exists, and the Toaster attaches once it does.
 */
export function Notifications({ children }: { children: ReactNode }) {
  const [controller, setController] = useState<ReactCloudletController | null>(null);
  const [settings, setSettings] = useState<ToasterSettings | null>(null);
  const { resolved } = useTheme();

  useEffect(() => {
    const instance = createCloudlet();
    setController(instance);
    return () => instance.dispose();
  }, []);

  return (
    <CloudletProvider controller={controller}>
      <ToasterSettingsContext.Provider value={setSettings}>
        {children}
        {/* Toaster reads position and dir on every render: changing them needs no remount, the stack stays. */}
        <Toaster theme={resolved} position={settings?.position ?? 'auto'} {...(settings ? { dir: settings.dir } : {})} />
      </ToasterSettingsContext.Provider>
    </CloudletProvider>
  );
}

/** The page controller, or null on the server and before the client creates it. */
export function usePageNotifications() {
  return useOptionalCloudlet();
}

/** Applies page-owned Toaster options while the calling component is mounted. */
export function useToasterSettings(settings: ToasterSettings) {
  const set = useContext(ToasterSettingsContext);
  const { position, dir } = settings;
  useEffect(() => {
    set({ position, dir });
    return () => set(null);
  }, [set, position, dir]);
}

/**
 * Copies text and confirms with the real page Toaster. `toast: false` keeps the
 * success silent (the caller confirms in place); failures always notify.
 */
export function useCopy({ toast = true }: { toast?: boolean } = {}) {
  const controller = usePageNotifications();
  return useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        if (toast) controller?.show({ title: 'Copied', kind: 'success', dedupeKey: 'site-copied' });
        return true;
      } catch {
        controller?.show({
          title: "Couldn't copy",
          kind: 'error',
          description: { kind: 'text', text: 'Your browser blocked clipboard access.' },
          dedupeKey: 'site-copy-failed',
        });
        return false;
      }
    },
    [controller, toast],
  );
}
