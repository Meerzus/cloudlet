import type { OperationHandle, ReactCloudletController } from '@cloudlet/toast';
import type { IntroEnd } from './frame-protocol';

/**
 * The hero's intro (LANDING §5), looped by the hero: three toasts land one by one and stack
 * with a badge → pause → the stack opens into the Island → one slide → collapse.
 * The same runner drives the `/frame` screen and, for phone visitors, the page
 * Toaster. All values in milliseconds.
 */
export const INTRO_TIMING = {
  /** From the start of a run to the first arrival. */
  lead: 700,
  /** Between the three arrivals. */
  arrivalGap: 1000,
  /** The collapsed stack with its badge, before it opens. */
  stackPause: 1500,
  /** Reading the Island before the slide. */
  islandHold: 2000,
  /** On the second slide before collapsing. */
  slideHold: 1900,
  /** After the collapse settles; then the next run starts from an empty stack. */
  settle: 900,
  /** Upload progress ticks while the intro plays; it lands as success during the slide. */
  uploadTick: 600,
} as const;

const UPLOAD_START = 0.42;
const UPLOAD_STEP = 0.06;

/**
 * The package has no imperative open/collapse/navigate API: the Island opens from its
 * pill and collapses with Escape (DESIGN §1). Like the lab's pilot, the intro drives
 * exactly those user paths through public parts (`.cloudlet-pill`, the Island region).
 * Synthetic events are untrusted, so they never count as visitor input.
 */
export const pilot = {
  open(host: Element | null) {
    const pill = host?.querySelector<HTMLButtonElement>('.cloudlet-pill');
    pill?.click();
    return Boolean(pill);
  },
  key(host: Element | null, key: 'ArrowRight' | 'ArrowLeft' | 'Escape') {
    const island = host?.querySelector('.cloudlet-shell[role="region"]');
    island?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    return Boolean(island);
  },
};

/** Resolves true after `ms`, or false as soon as `signal` aborts. */
function pause(ms: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) return resolve(false);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve(true);
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

export interface IntroRun {
  /** Resolves when the scenario ends: played through or interrupted. */
  readonly done: Promise<IntroEnd>;
  /** Interrupts the scenario where it is; notifications already shown stay. */
  stop(): void;
  /** Stops the scenario and cancels the demo upload (before `clear()`). */
  cancel(): void;
}

export function playIntro(controller: ReactCloudletController, host: () => Element | null): IntroRun {
  const scenario = new AbortController();
  let upload: OperationHandle<void> | null = null;
  const t = INTRO_TIMING;

  async function run(signal: AbortSignal): Promise<IntroEnd> {
    if (!(await pause(t.lead, signal))) return 'interrupted';
    controller.show({ title: 'Synced to the cloud', kind: 'success', attention: 'stack' });

    if (!(await pause(t.arrivalGap, signal))) return 'interrupted';
    // A real tracked operation: it keeps uploading if the visitor interrupts the intro.
    // A promise (not a factory) source: a finished upload offers no Retry.
    const abort = new AbortController();
    const operation = controller.track(uploadPhotos(), {
      pending: {
        title: 'Uploading 12 photos…',
        progress: { kind: 'determinate', value: UPLOAD_START, label: `${Math.round(UPLOAD_START * 100)}%` },
        attention: 'stack',
      },
      success: { title: '12 photos are in the cloud' },
      error: { title: 'Upload drifted off', attention: 'stack' },
      cancelled: { title: 'Upload cancelled', attention: 'stack' },
      cancel: () => abort.abort(),
    });
    upload = operation;
    async function uploadPhotos() {
      for (let value = UPLOAD_START + UPLOAD_STEP; value < 1; value += UPLOAD_STEP) {
        await new Promise((resolve) => setTimeout(resolve, t.uploadTick));
        abort.signal.throwIfAborted();
        if (operation.admission.status === 'created') {
          controller.update(operation.admission.handle, {
            progress: { kind: 'determinate', value, label: `${Math.round(value * 100)}%` },
          });
        }
      }
    }

    if (!(await pause(t.arrivalGap, signal))) return 'interrupted';
    controller.show({
      title: 'Storm ahead: storage almost full',
      kind: 'warning',
      description: { kind: 'text', text: 'Only 3% of your sky is left.' },
      action: {
        kind: 'command',
        label: 'Upgrade',
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 900));
          controller.show({ title: 'Clear skies: storage doubled', kind: 'success' });
        },
      },
      // The intro opens the Island itself, after the stack has had its moment.
      attention: 'stack',
    });

    if (!(await pause(t.stackPause, signal))) return 'interrupted';
    pilot.open(host());
    if (!(await pause(t.islandHold, signal))) return 'interrupted';
    pilot.key(host(), document.documentElement.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
    if (!(await pause(t.slideHold, signal))) return 'interrupted';
    pilot.key(host(), 'Escape');
    if (!(await pause(t.settle, signal))) return 'interrupted';
    return 'complete';
  }

  return {
    done: run(scenario.signal),
    stop: () => scenario.abort(),
    cancel() {
      scenario.abort();
      upload?.cancel();
    },
  };
}
