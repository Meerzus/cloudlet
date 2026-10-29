'use client';

import { useEffect, useState, version } from 'react';
import { createCloudlet, useOptionalCloudlet, type ReactCloudletController } from '@cloudlet/toast';
import { Toaster } from '@/components/ui/toaster';

function Controls() {
  const controller = useOptionalCloudlet();
  return <button disabled={!controller} onClick={() => { controller?.show({ title: 'Installed wrapper action', duration: null }); }}>Notify</button>;
}

export function RegistryDemo() {
  const [controller, setController] = useState<ReactCloudletController | null>(null);
  const [browserReactVersion, setBrowserReactVersion] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    setBrowserReactVersion(version);
    const owner = createCloudlet({ autoDismiss: false });
    owner.show({ title: 'Before provider mount', duration: null });
    setController(owner);
    return () => { owner.dispose(); };
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    return () => { document.documentElement.classList.remove('dark'); };
  }, [theme]);
  return <>
    <p data-registry-react-version={browserReactVersion ?? undefined}>Browser React version: {browserReactVersion ?? "pending hydration"}</p>
    <button onClick={() => { setTheme((current) => current === 'light' ? 'dark' : 'light'); }}>Toggle theme</button>
    <Toaster controller={controller} theme={theme}><Controls /></Toaster>
  </>;
}
