'use client';

import { StrictMode, useEffect, useState, version } from 'react';
import { CloudletProvider, createCloudlet, Toaster, useCloudlet } from '@cloudlet/toast';
import type { NotificationHandle, ReactCloudletController, ReactNotificationSpec } from '@cloudlet/toast';

function session() {
  const first = createCloudlet({ autoDismiss: false });
  const second = createCloudlet({ autoDismiss: false });
  // `attention: 'stack'`: the pre-mount records stay collapsed so the tests open the Island themselves.
  first.show({ id: 'pre-mount', title: 'Pre-mount notification', duration: null, attention: 'stack',
    description: { kind: 'text', text: 'Packed runtime, hydrated client, expandable content. '.repeat(12) },
    progress: { kind: 'determinate', value: 0.2, label: 'Transfer' } });
  second.show({ id: 'pre-mount', title: 'Independent notification', duration: null, attention: 'stack' });
  return { first, second, actionCount: 0, effectSetups: 0, effectCleanups: 0 };
}

export interface IntegrationApi {
  first: ReactCloudletController;
  second: ReactCloudletController;
  actionCount: () => number;
  reactVersion: string;
  strictEffects: () => { setups: number; cleanups: number };
  show: (spec: ReactNotificationSpec) => NotificationHandle;
  mounted: boolean;
  setMounted: (value: boolean) => void;
}

declare global { interface Window { integration?: IntegrationApi; } }

function HookProbe({ expected }: { expected: ReactCloudletController }) {
  const actual = useCloudlet();
  if (actual !== expected) throw new Error('Provider returned another controller');
  return null;
}

/** Controller creation is client-local; only serializable nonce crosses the RSC boundary. */
export function Consumer({ nonce }: { nonce: string }) {
  const [owned] = useState(session);
  const [mounted, setMounted] = useState(true);
  const [dark, setDark] = useState(false);
  const [rtl, setRtl] = useState(false);
  useEffect(() => { owned.effectSetups++; return () => { owned.effectCleanups++; }; }, [owned]);
  useEffect(() => {
    window.integration = {
      first: owned.first, second: owned.second,
      actionCount: () => owned.actionCount, reactVersion: version, strictEffects: () => ({ setups: owned.effectSetups, cleanups: owned.effectCleanups }),
      show: spec => {
        const result = owned.first.show(spec);
        if (result.status === 'rejected') throw new Error(result.reason);
        return result.handle;
      }, mounted, setMounted,
    };
    return () => { delete window.integration; };
  }, [owned, mounted]);
  return <StrictMode><main>
    <h1>Tarball consumer SSR marker</h1>
    <p>Installation uses @cloudlet/toast from a local npm-pack archive.</p>
    <button onClick={() => setMounted(value => !value)}>Toggle mount</button>
    <button onClick={() => setDark(value => !value)}>Toggle theme</button>
    <button onClick={() => setRtl(value => !value)}>Toggle direction</button>
    <button onClick={() => owned.first.show({ id: `action-${owned.actionCount}`, title: 'Action notification', duration: null,
      action: { kind: 'command', label: 'Run command', run: () => { owned.actionCount += 1; } } })}>Add action</button>
    <div id="consumer-portal" aria-label="Explicit portal" />
    <CloudletProvider controller={owned.first}>
      <HookProbe expected={owned.first} />
      {mounted && <Toaster nonce={nonce} theme={dark ? 'dark' : 'light'} dir={rtl ? 'rtl' : 'ltr'}
        labels={{ region: 'Primary notifications' }} container={() => document.getElementById('consumer-portal')} />}
    </CloudletProvider>
    <CloudletProvider controller={owned.second}>
      <HookProbe expected={owned.second} />
      {mounted && <Toaster nonce={nonce} theme="light" position="bottom-center" labels={{ region: 'Secondary notifications' }} />}
    </CloudletProvider>
  </main></StrictMode>;
}
