import type { ReactCloudletController } from '@cloudlet/toast';
import { GITHUB_URL } from './site';

/**
 * Shared demo catalog. One entry = one call through the public API
 * plus the snippet a visitor copies; `/playground` renders every group. A unit test runs every snippet and its `run` against a
 * recording controller and requires identical calls, so the two cannot drift.
 *
 * Snippets are plain JavaScript (JSX where a slot takes a React node) that assume `const cloudlet = useCloudlet();`.
 */

export type DemoGroup = 'Kinds' | 'Content' | 'Actions' | 'Promises' | 'Attention' | 'Stack';

export interface Demo {
  readonly id: string;
  readonly group: DemoGroup;
  readonly label: string;
  readonly run: (cloudlet: ReactCloudletController) => void;
  readonly snippet: string;
}

/** Playground sections, in page order. */
export const DEMO_GROUPS: readonly { readonly id: DemoGroup; readonly blurb: string }[] = [
  { id: 'Kinds', blurb: 'Five kinds of weather. Success and info drift off after six seconds; the rest stay until you close them.' },
  { id: 'Content', blurb: 'A title, a line of description, rich text or an icon of your own.' },
  { id: 'Actions', blurb: 'A command, a real link, and a command that fails once and offers a retry.' },
  { id: 'Promises', blurb: 'track() follows an operation from pending to its result; update() changes a card in place.' },
  { id: 'Attention', blurb: 'Whether a notification opens the Island on its own: auto, open or stack.' },
  { id: 'Stack', blurb: 'Newest on top, one pill at rest. Push it past 100 and the badge counts what was missed.' },
];

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const PHOTOS = 12;
const CLOUDS = ['Cumulus', 'Stratus', 'Cirrus', 'Nimbus', 'Altocumulus'] as const;
/** Five more than the controller's capacity of 100 accepted records. */
const OVERFLOW = 105;

export const DEMOS: readonly Demo[] = [
  {
    id: 'success',
    group: 'Kinds',
    label: 'Success',
    run: (cloudlet) => {
      cloudlet.show({ title: 'Synced to the cloud', kind: 'success' });
    },
    snippet: `cloudlet.show({ title: 'Synced to the cloud', kind: 'success' });`,
  },
  {
    id: 'error',
    group: 'Kinds',
    label: 'Error',
    run: (cloudlet) => {
      cloudlet.show({ title: 'Sync got lost in the fog', kind: 'error' });
    },
    snippet: `cloudlet.show({ title: 'Sync got lost in the fog', kind: 'error' });`,
  },
  {
    id: 'info',
    group: 'Kinds',
    label: 'Info',
    run: (cloudlet) => {
      cloudlet.show({ title: 'Light breeze from the west', kind: 'info' });
    },
    snippet: `cloudlet.show({ title: 'Light breeze from the west', kind: 'info' });`,
  },
  {
    id: 'warning',
    group: 'Kinds',
    label: 'Warning',
    run: (cloudlet) => {
      cloudlet.show({ title: 'Clouds are gathering', kind: 'warning' });
    },
    snippet: `cloudlet.show({ title: 'Clouds are gathering', kind: 'warning' });`,
  },
  {
    id: 'loading',
    group: 'Kinds',
    label: 'Loading',
    run: (cloudlet) => {
      cloudlet.show({ title: 'Gathering clouds…', kind: 'loading' });
    },
    snippet: `cloudlet.show({ title: 'Gathering clouds…', kind: 'loading' });`,
  },
  {
    id: 'title-only',
    group: 'Content',
    label: 'Title only',
    run: (cloudlet) => {
      cloudlet.show({ title: 'A small cloud drifted by' });
    },
    snippet: `cloudlet.show({ title: 'A small cloud drifted by' });`,
  },
  {
    id: 'description',
    group: 'Content',
    label: 'Description',
    run: (cloudlet) => {
      cloudlet.show({
        title: 'Forecast updated',
        description: { kind: 'text', text: 'Sunny above the clouds, light drizzle below.' },
      });
    },
    snippet: `cloudlet.show({
  title: 'Forecast updated',
  description: { kind: 'text', text: 'Sunny above the clouds, light drizzle below.' },
});`,
  },
  {
    id: 'rich-description',
    group: 'Content',
    label: 'Rich description',
    run: (cloudlet) => {
      cloudlet.show({
        title: 'Cruising altitude reached',
        description: {
          kind: 'rich',
          content: <>Above the clouds at <strong>10,000 m</strong>, the sky is <em>perfectly</em> clear.</>,
          announcement: 'Above the clouds at 10,000 m, the sky is perfectly clear.',
        },
      });
    },
    snippet: `cloudlet.show({
  title: 'Cruising altitude reached',
  description: {
    kind: 'rich',
    content: <>Above the clouds at <strong>10,000 m</strong>, the sky is <em>perfectly</em> clear.</>,
    announcement: 'Above the clouds at 10,000 m, the sky is perfectly clear.',
  },
});`,
  },
  {
    id: 'custom-icon',
    group: 'Content',
    label: 'Custom icon',
    run: (cloudlet) => {
      cloudlet.show({
        title: 'Spotted a cloud shaped like a cat',
        icon: (
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M7 19a5 5 0 0 1-.6-9.96 6.5 6.5 0 0 1 12.3 1.7A4.2 4.2 0 0 1 17.8 19z" />
          </svg>
        ),
      });
    },
    snippet: `cloudlet.show({
  title: 'Spotted a cloud shaped like a cat',
  icon: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 19a5 5 0 0 1-.6-9.96 6.5 6.5 0 0 1 12.3 1.7A4.2 4.2 0 0 1 17.8 19z" />
    </svg>
  ),
});`,
  },
  {
    id: 'action-command',
    group: 'Actions',
    label: 'Command',
    run: (cloudlet) => {
      cloudlet.show({
        title: 'Photo moved to the archive',
        action: {
          kind: 'command',
          label: 'Undo',
          run: () => {
            cloudlet.show({ title: 'Photo is back in the sky', kind: 'success' });
          },
        },
      });
    },
    snippet: `cloudlet.show({
  title: 'Photo moved to the archive',
  action: {
    kind: 'command',
    label: 'Undo',
    run: () => {
      cloudlet.show({ title: 'Photo is back in the sky', kind: 'success' });
    },
  },
});`,
  },
  {
    id: 'action-link',
    group: 'Actions',
    label: 'Link',
    run: (cloudlet) => {
      cloudlet.show({
        title: 'These clouds are open source',
        action: { kind: 'link', label: 'GitHub', href: GITHUB_URL, target: '_blank', rel: 'noreferrer' },
      });
    },
    snippet: `cloudlet.show({
  title: 'These clouds are open source',
  action: { kind: 'link', label: 'GitHub', href: '${GITHUB_URL}', target: '_blank', rel: 'noreferrer' },
});`,
  },
  {
    id: 'action-retry',
    group: 'Actions',
    label: 'Share fails → Retry',
    run: (cloudlet) => {
      let tries = 0;
      cloudlet.show({
        title: 'Album ready to share',
        action: {
          kind: 'command',
          label: 'Share',
          errorMessage: () => 'A gust blew it away. Try again?',
          run: async () => {
            await wait(800);
            tries += 1;
            if (tries === 1) throw new Error('Gust of wind');
            cloudlet.show({ title: 'Album shared with the sky', kind: 'success' });
          },
        },
      });
    },
    snippet: `let tries = 0;
cloudlet.show({
  title: 'Album ready to share',
  action: {
    kind: 'command',
    label: 'Share',
    errorMessage: () => 'A gust blew it away. Try again?',
    run: async () => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      tries += 1;
      if (tries === 1) throw new Error('Gust of wind');
      cloudlet.show({ title: 'Album shared with the sky', kind: 'success' });
    },
  },
});`,
  },
  {
    id: 'track-resolve',
    group: 'Promises',
    label: 'Resolve',
    run: (cloudlet) => {
      cloudlet.track(wait(1500), {
        pending: { title: 'Condensing water vapour…' },
        success: { title: 'A fresh cloud formed' },
        error: { title: 'The cloud evaporated' },
      });
    },
    snippet: `cloudlet.track(new Promise((resolve) => setTimeout(resolve, 1500)), {
  pending: { title: 'Condensing water vapour…' },
  success: { title: 'A fresh cloud formed' },
  error: { title: 'The cloud evaporated' },
});`,
  },
  {
    id: 'error-retry',
    group: 'Promises',
    label: 'Reject → Retry',
    run: (cloudlet) => {
      cloudlet.track(
        async ({ attempt }) => {
          await wait(1200);
          if (attempt === 1) throw new Error('No signal above the clouds');
        },
        {
          pending: { title: 'Reaching the sky…' },
          success: { title: 'Back in the sky' },
          error: {
            title: "Couldn't reach the sky",
            description: { kind: 'text', text: 'Thick clouds in the way. The second try gets through.' },
          },
        },
      );
    },
    snippet: `cloudlet.track(async ({ attempt }) => {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  if (attempt === 1) throw new Error('No signal above the clouds');
}, {
  pending: { title: 'Reaching the sky…' },
  success: { title: 'Back in the sky' },
  error: {
    title: "Couldn't reach the sky",
    description: { kind: 'text', text: 'Thick clouds in the way. The second try gets through.' },
  },
});`,
  },
  {
    id: 'promise-progress',
    group: 'Promises',
    label: 'Progress',
    run: (cloudlet) => {
      const abort = new AbortController();
      const upload = cloudlet.track(uploadPhotos(), {
        pending: { title: 'Uploading 12 photos…', progress: { kind: 'determinate', value: 0 } },
        success: { title: '12 photos are in the cloud' },
        error: { title: 'Upload drifted off' },
        cancel: () => abort.abort(),
      });

      async function uploadPhotos() {
        for (let photo = 1; photo <= PHOTOS; photo += 1) {
          await wait(220);
          abort.signal.throwIfAborted();
          if (upload.admission.status === 'created') {
            cloudlet.update(upload.admission.handle, {
              progress: { kind: 'determinate', value: photo / PHOTOS, label: `${photo} of ${PHOTOS}` },
            });
          }
        }
      }
    },
    snippet: `const abort = new AbortController();
const upload = cloudlet.track(uploadPhotos(), {
  pending: { title: 'Uploading 12 photos…', progress: { kind: 'determinate', value: 0 } },
  success: { title: '12 photos are in the cloud' },
  error: { title: 'Upload drifted off' },
  cancel: () => abort.abort(),
});

async function uploadPhotos() {
  for (let photo = 1; photo <= 12; photo += 1) {
    await new Promise((resolve) => setTimeout(resolve, 220));
    abort.signal.throwIfAborted();
    if (upload.admission.status === 'created') {
      cloudlet.update(upload.admission.handle, {
        progress: { kind: 'determinate', value: photo / 12, label: \`\${photo} of 12\` },
      });
    }
  }
}`,
  },
  {
    id: 'track-cancel',
    group: 'Promises',
    label: 'Cancel',
    run: (cloudlet) => {
      cloudlet.track(
        async ({ signal }) => {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 8000);
            signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
          });
        },
        {
          pending: {
            title: 'Drifting to the coast…',
            description: { kind: 'text', text: 'A long flight. Cancel lands it early.' },
          },
          success: { title: 'Landed on the coast' },
          error: { title: 'Lost the wind' },
          cancelled: { title: 'Landed early' },
        },
      );
    },
    snippet: `cloudlet.track(async ({ signal }) => {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 8000);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}, {
  pending: {
    title: 'Drifting to the coast…',
    description: { kind: 'text', text: 'A long flight. Cancel lands it early.' },
  },
  success: { title: 'Landed on the coast' },
  error: { title: 'Lost the wind' },
  cancelled: { title: 'Landed early' },
});`,
  },
  {
    id: 'update-loading',
    group: 'Promises',
    label: 'update() → success',
    run: (cloudlet) => {
      const packing = cloudlet.show({ title: 'Packing the clouds…', kind: 'loading' });
      setTimeout(() => {
        if (packing.status === 'created') {
          cloudlet.update(packing.handle, { title: 'Clouds packed', kind: 'success' });
        }
      }, 1500);
    },
    snippet: `const packing = cloudlet.show({ title: 'Packing the clouds…', kind: 'loading' });
setTimeout(() => {
  if (packing.status === 'created') {
    cloudlet.update(packing.handle, { title: 'Clouds packed', kind: 'success' });
  }
}, 1500);`,
  },
  {
    id: 'attention-auto',
    group: 'Attention',
    label: 'auto',
    run: (cloudlet) => {
      cloudlet.show({
        title: 'Wind is picking up',
        description: { kind: 'text', text: 'Gusts up to 40 km/h this afternoon.' },
        attention: 'auto',
      });
    },
    snippet: `cloudlet.show({
  title: 'Wind is picking up',
  description: { kind: 'text', text: 'Gusts up to 40 km/h this afternoon.' },
  attention: 'auto',
});`,
  },
  {
    id: 'attention-upgrade',
    group: 'Attention',
    label: 'open',
    run: (cloudlet) => {
      cloudlet.show({
        title: 'Storm ahead: storage almost full',
        kind: 'warning',
        description: { kind: 'text', text: 'Only 3% of your sky is left.' },
        action: {
          kind: 'command',
          label: 'Upgrade',
          run: async () => {
            await wait(900);
            cloudlet.show({ title: 'Clear skies: storage doubled', kind: 'success' });
          },
        },
        attention: 'open',
      });
    },
    snippet: `cloudlet.show({
  title: 'Storm ahead: storage almost full',
  kind: 'warning',
  description: { kind: 'text', text: 'Only 3% of your sky is left.' },
  action: {
    kind: 'command',
    label: 'Upgrade',
    run: async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      cloudlet.show({ title: 'Clear skies: storage doubled', kind: 'success' });
    },
  },
  attention: 'open',
});`,
  },
  {
    id: 'attention-stack',
    group: 'Attention',
    label: 'stack',
    run: (cloudlet) => {
      cloudlet.show({
        title: 'Drizzle expected tonight',
        kind: 'warning',
        description: { kind: 'text', text: 'Keep an umbrella by the door.' },
        attention: 'stack',
      });
    },
    snippet: `cloudlet.show({
  title: 'Drizzle expected tonight',
  kind: 'warning',
  description: { kind: 'text', text: 'Keep an umbrella by the door.' },
  attention: 'stack',
});`,
  },
  {
    id: 'burst',
    group: 'Stack',
    label: 'Burst ×5',
    run: (cloudlet) => {
      for (const name of CLOUDS) cloudlet.show({ title: `${name} drifted by` });
    },
    snippet: `for (const name of ['Cumulus', 'Stratus', 'Cirrus', 'Nimbus', 'Altocumulus']) {
  cloudlet.show({ title: \`\${name} drifted by\` });
}`,
  },
  {
    id: 'overflow',
    group: 'Stack',
    label: 'Overflow',
    run: (cloudlet) => {
      for (let cloud = 1; cloud <= OVERFLOW; cloud += 1) cloudlet.show({ title: `Cloud #${cloud} on the horizon` });
    },
    snippet: `// The stack holds 100 notifications; the rest are counted as missed.
for (let cloud = 1; cloud <= 105; cloud += 1) {
  cloudlet.show({ title: \`Cloud #\${cloud} on the horizon\` });
}`,
  },
  {
    id: 'dismiss-all',
    group: 'Stack',
    label: 'Dismiss all',
    run: (cloudlet) => {
      cloudlet.clear();
      cloudlet.acknowledgeOverflow();
    },
    snippet: `cloudlet.clear();
cloudlet.acknowledgeOverflow(); // the missed count survives clear()`,
  },
];

/** Whether a demo's label is an API value (`attention: 'auto'` …) and reads in the code font. */
export function isCodeLabel(demo: Demo): boolean {
  return demo.group === 'Attention';
}

export function findDemo(id: string): Demo | undefined {
  return DEMOS.find((demo) => demo.id === id);
}

export function demosIn(group: DemoGroup): readonly Demo[] {
  return DEMOS.filter((demo) => demo.group === group);
}
