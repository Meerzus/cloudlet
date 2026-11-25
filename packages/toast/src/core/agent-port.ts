import type { NotificationHandle } from '../contracts/identity.js';
import type { FormErrors, RendererSnapshot } from '../contracts/internal.js';
import type { ControllerSnapshot } from '../contracts/snapshots.js';
import { getControllerKernel } from './controller.js';

// The agent adapter's read-only way into a controller. Only the `agent` entry imports it, so the
// root entry and the renderer chunk never carry it. It hands out no lease, no tokens of the
// renderer and no mutators; form values are reduced to "holds text" here, before they leave core.

const freeze = Object.freeze;

/** What a reader may know about a form: which fields hold text and the last submit's messages. */
export interface FormReading {
  /** Names of the fields whose value has non-blank text, the same test `required` uses. */
  readonly filled: ReadonlySet<string>;
  readonly errors: FormErrors;
}

export interface ToasterReading<Slot> {
  readonly controller: ControllerSnapshot<Slot>;
  /** A `Toaster` holds the controller's host lease. */
  readonly mounted: boolean;
  /** One entry per record with a form action. */
  readonly forms: ReadonlyMap<NotificationHandle, FormReading>;
}

export interface ToasterReadPort<Slot> {
  /** The same object until the controller publishes again. */
  readonly read: () => ToasterReading<Slot>;
  readonly subscribe: (listener: () => void) => () => void;
}

/** Throws a TypeError for a controller this package instance did not create. */
export function createToasterReadPort<Slot>(controller: object): ToasterReadPort<Slot> {
  const kernel = getControllerKernel<Slot>(controller);
  let source: RendererSnapshot<Slot> | undefined;
  let mounted = false;
  let reading: ToasterReading<Slot> | undefined;

  const read = (): ToasterReading<Slot> => {
    const next = kernel.rendererSnapshot;
    const lease = kernel.lease !== null;
    if (reading && next === source && lease === mounted) return reading;
    source = next;
    mounted = lease;
    const forms = new Map<NotificationHandle, FormReading>();
    for (const form of next.forms) {
      const filled = new Set(Object.keys(form.values).filter((name) => form.values[name]!.trim() !== ''));
      forms.set(form.handle, freeze({ filled, errors: form.errors }));
    }
    reading = freeze({ controller: next, mounted, forms });
    return reading;
  };

  return freeze({ read, subscribe: kernel.subscribe });
}
