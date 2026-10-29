import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { getControllerKernel } from '../core/controller.js';
import type { CloudletProviderProps, ReactCloudletController, ToasterProps } from '../react.js';

type Renderer = typeof import('./renderer.js');

/** Undefined outside a provider; null inside one whose controller does not exist yet. */
const CloudletContext = createContext<ReactCloudletController | null | undefined>(undefined);
let renderer: Renderer | undefined;
let loading: Promise<Renderer> | undefined;

export function CloudletProvider({ controller, children }: CloudletProviderProps): ReactElement {
  return <CloudletContext.Provider value={controller}>{children}</CloudletContext.Provider>;
}

export function useCloudlet(): ReactCloudletController {
  const controller = useContext(CloudletContext);
  if (!controller) throw new Error('useCloudlet must be used within a CloudletProvider that has a controller');
  return controller;
}

/** The controller, or null outside a provider and while the provider's controller is null. */
export function useOptionalCloudlet(): ReactCloudletController | null {
  return useContext(CloudletContext) ?? null;
}

/** Fetches the renderer chunk once for every Toaster; after a failure the next attempt fetches again. */
export function loadRenderer(): Promise<Renderer> {
  loading ??= import('./renderer.js').then((module) => (renderer = module), (error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

/**
 * The renderer stays out of the start bundle: the chunk loads after mount, and
 * notifications shown meanwhile wait in the controller. On the server and during
 * hydration this renders nothing, exactly like the attached renderer does.
 */
export function Toaster(options: ToasterProps): ReactElement | null {
  const controller = useContext(CloudletContext);
  if (controller === undefined) throw new Error('Toaster must be used within a CloudletProvider');
  const [loaded, setLoaded] = useState(renderer);
  useEffect(() => {
    if (loaded) return;
    let live = true;
    loadRenderer().then((module) => { if (live) setLoaded(module); }, (error: unknown) => {
      if (live && controller) getControllerKernel(controller).reportRendererLoadError(error);
    });
    return () => { live = false; };
  }, [loaded, controller]);
  // A provider without a controller yet (server, first client render) renders nothing.
  return controller && loaded ? <loaded.AttachedToaster controller={controller} options={options} /> : null;
}
