'use client';

import { CloudletProvider, createCloudlet, Toaster, type ReactCloudletController } from '@cloudlet/toast';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Puppet } from '@/components/puppets/puppet';
import { pilot } from '@/lib/intro';
import type { PuppetFace, PuppetState } from '@/lib/puppet-model';
import { Puppeteer } from '@/lib/puppeteer';

/**
 * Accuracy stand: the real Toaster and a puppet in the same place,
 * at 1:1, so `scripts/puppet-check.mjs` can compare screenshots of each alone.
 * `/puppet-check?case=pill&theme=dark&show=real|puppet|both`.
 */

const SYNCED: PuppetFace = { id: 'synced', kind: 'success', title: 'Synced to the cloud' };
const STORM: PuppetFace = {
  id: 'storm',
  kind: 'warning',
  title: 'Storm ahead: storage almost full',
  description: 'Only 3% of your sky is left.',
  action: 'Upgrade',
};
const UPLOAD: PuppetFace = { id: 'upload', kind: 'loading', title: 'Uploading 12 photos…', ring: true };
const REACHING: PuppetFace = { id: 'reaching', kind: 'loading', title: 'Reaching the sky…' };
/** Scene 3: a pending operation that can be cancelled; the stand relabels Cancel like the site. */
const SYNCING: PuppetFace = { id: 'syncing', kind: 'loading', title: 'Syncing 3 files…', cancel: 'Cancel' };
const LABELS = { cancel: 'Cancel' } as const;
const FAILED: PuppetFace = {
  id: 'failed',
  kind: 'error',
  title: "Couldn't reach the sky",
  description: 'Thick clouds in the way. The second try gets through.',
  retry: true,
};

interface Case {
  readonly puppet: PuppetState;
  /** Drives the real controller into the same state. */
  readonly real: (cloudlet: ReactCloudletController, host: () => Element | null) => Promise<void>;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const forever = new Promise<never>(() => {});
/** Terminal messages the stand never reaches (track requires them). */
const ENDS = { success: { title: 'Done' }, error: { title: 'Failed' } } as const;

async function three(cloudlet: ReactCloudletController) {
  cloudlet.show({ title: SYNCED.title, kind: 'success', duration: null, attention: 'stack' });
  await wait(250);
  cloudlet.show({ title: 'Forecast: clear skies', kind: 'info', duration: null, attention: 'stack' });
  await wait(250);
  cloudlet.show({
    title: STORM.title,
    kind: 'warning',
    description: { kind: 'text', text: STORM.description! },
    action: { kind: 'command', label: STORM.action!, run: () => {} },
    attention: 'stack',
  });
}

export const CASES = {
  pill: {
    puppet: { face: SYNCED, mode: 'pill' },
    real: async (cloudlet) => void cloudlet.show({ title: SYNCED.title, kind: 'success', duration: null }),
  },
  loading: {
    puppet: { face: REACHING, mode: 'pill' },
    real: async (cloudlet) => void cloudlet.track(forever, { ...ENDS, pending: { title: REACHING.title, attention: 'stack' } }),
  },
  stack: {
    puppet: { face: STORM, mode: 'pill', count: 3 },
    real: three,
  },
  island: {
    puppet: { face: STORM, mode: 'island', count: 3 },
    real: async (cloudlet, host) => {
      await three(cloudlet);
      await wait(600);
      pilot.open(host());
    },
  },
  dots: {
    puppet: { face: STORM, mode: 'island', count: 2 },
    real: async (cloudlet, host) => {
      cloudlet.show({ title: SYNCED.title, kind: 'success', duration: null, attention: 'stack' });
      await wait(250);
      cloudlet.show({
        title: STORM.title,
        kind: 'warning',
        description: { kind: 'text', text: STORM.description! },
        action: { kind: 'command', label: STORM.action!, run: () => {} },
        attention: 'stack',
      });
      await wait(600);
      pilot.open(host());
    },
  },
  cancel: {
    puppet: { face: SYNCING, mode: 'island' },
    real: async (cloudlet, host) => {
      cloudlet.track(() => forever, { ...ENDS, pending: { title: SYNCING.title, attention: 'stack' } });
      await wait(400);
      pilot.open(host());
    },
  },
  'progress-pill': {
    puppet: { face: UPLOAD, mode: 'pill', progress: 0.42 },
    real: async (cloudlet) =>
      void cloudlet.track(forever, {
        ...ENDS,
        pending: { title: UPLOAD.title, progress: { kind: 'determinate', value: 0.42 }, attention: 'stack' },
      }),
  },
  progress: {
    puppet: { face: UPLOAD, mode: 'island', progress: 0.42 },
    real: async (cloudlet, host) => {
      cloudlet.track(forever, {
        ...ENDS,
        pending: { title: UPLOAD.title, progress: { kind: 'determinate', value: 0.42 }, attention: 'stack' },
      });
      await wait(400);
      pilot.open(host());
    },
  },
  retry: {
    puppet: { face: FAILED, mode: 'island' },
    real: async (cloudlet, host) => {
      cloudlet.track(
        async () => {
          throw new Error('No signal above the clouds');
        },
        {
          pending: { title: REACHING.title, attention: 'stack' },
          success: ENDS.success,
          error: { title: FAILED.title, description: { kind: 'text', text: FAILED.description! }, attention: 'stack' },
        },
      );
      await wait(400);
      pilot.open(host());
    },
  },
} satisfies Record<string, Case>;

export type CheckCase = keyof typeof CASES;

function params() {
  const query = new URLSearchParams(window.location.search);
  const name = query.get('case');
  return {
    name: (name && name in CASES ? name : 'pill') as CheckCase,
    theme: query.get('theme') === 'dark' ? ('dark' as const) : ('light' as const),
    show: query.get('show') ?? 'both',
  };
}

export function PuppetCheck() {
  const [setup, setSetup] = useState<ReturnType<typeof params> | null>(null);
  const [controller, setController] = useState<ReactCloudletController | null>(null);
  const puppet = useRef<HTMLDivElement>(null);
  const realReady = useRef(false);

  useEffect(() => {
    setSetup(params());
    const instance = createCloudlet();
    setController(instance);
    return () => instance.dispose();
  }, []);

  useLayoutEffect(() => {
    if (!setup || !puppet.current) return;
    new Puppeteer(puppet.current, [CASES[setup.name].puppet]).set(0);
  }, [setup]);

  useEffect(() => {
    if (!setup || !controller || realReady.current) return;
    realReady.current = true;
    const host = () => document.querySelector('.cloudlet-host');
    void CASES[setup.name]
      .real(controller, host)
      .then(() => wait(1600))
      .then(() => {
        document.documentElement.dataset.checkReady = '';
      });
  }, [setup, controller]);

  if (!setup) return null;
  return (
    <div className="puppet-check" data-show={setup.show}>
      {controller ? (
        <CloudletProvider controller={controller}>
          <Toaster theme={setup.theme} position="top-center" labels={LABELS} />
        </CloudletProvider>
      ) : null}
      <div className="puppet-check-slot">
        <Puppet ref={puppet} states={[CASES[setup.name].puppet]} theme={setup.theme} />
      </div>
    </div>
  );
}
