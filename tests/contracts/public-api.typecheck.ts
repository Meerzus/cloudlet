/** Compile-only contract examples. No runtime behavior is simulated here. */
import type { ReactNode } from 'react';
import type {
  AdmissionResult,
  CancellationSignal,
  CloudletMotionConstants,
  CloudletMotionOverrides,
  CloudletPart,
  CloudletProviderProps,
  CloudletProviderComponent,
  CreateCloudlet,
  ToasterMotion,
  NotificationController,
  NotificationHandle,
  NotificationSpec,
  OperationAdmissionResult,
  ReactCloudletController,
  ReactTrackOptions,
  ToasterProps,
  ToasterComponent,
  UseCloudlet,
  UseOptionalCloudlet,
} from '../../packages/toast/src/index.js';

import { CloudletProvider, createCloudlet, Toaster, useCloudlet, useOptionalCloudlet } from '../../packages/toast/src/index.js';
// @ts-expect-error The renderer bridge is package-private.
import type { RendererBridge } from '../../packages/toast/src/index.js';

export function verifyPublicContracts(factory: CreateCloudlet, slot: ReactNode) {
  const controller = factory();
  const provider: CloudletProviderProps = { controller, children: slot };
  const providerComponent: CloudletProviderComponent = CloudletProvider;
  const toasterComponent: ToasterComponent = Toaster;
  const controllerHook: UseCloudlet = useCloudlet;
  const optionalHook: UseOptionalCloudlet = useOptionalCloudlet;
  // An effect-owned controller does not exist on the server or in the first client render.
  const pendingProvider: CloudletProviderProps = { controller: null, children: slot };
  // @ts-expect-error Toaster gets a controller only through its Provider.
  const directController: ToasterProps = { controller };
  const rich: NotificationSpec<ReactNode> = {
    title: 'Upload',
    description: { kind: 'rich', content: slot, announcement: 'One file is ready' },
  };
  const admission: AdmissionResult = controller.show(rich);
  const options: ReactTrackOptions<Response> = {
    pending: { title: 'Uploading' },
    success: (response) => ({ title: `HTTP ${response.status}` }),
    error: { title: 'Upload failed' },
  };
  // Native fetch interop is intentional; no DOM types leak into core contracts.
  const operation = controller.track(({ signal }) => fetch('/upload', { signal }), options);
  const businessResult: Promise<Response> = operation.result;
  const operationAdmission: OperationAdmissionResult = operation.admission;
  const nativeSignal: CancellationSignal = new AbortController().signal;
  const toaster: ToasterProps = {
    dir: 'rtl',
    attention: { delay: 400 },
    autoDismiss: false,
    motion: { timeScale: 0.25, overrides: { shapeOpen: { stiffness: 240 }, blur: 4 } },
    offsets: { gutter: { bottom: 16 }, obstruction: { bottom: 48 } },
    labels: { close: 'Закрыть' },
    classNames: { host: 'toasts', pill: 'toasts-pill', action: 'toasts-action' },
  };

  if (admission.status !== 'rejected') {
    const live = admission.handle;
    controller.update(live, { description: null, duration: null });
    // @ts-expect-error Manual selection was removed with presentation modes in rc.1.
    controller.select(live);
    controller.update(live, { attention: 'stack' });
    controller.requestFocus({ kind: 'notification', handle: live, control: 'close' });
    // @ts-expect-error Private handle brand prevents construction from copied fields.
    const forged: NotificationHandle = { id: live.id, controller: live.controller, generation: live.generation };
    // @ts-expect-error A string ID is not a generation-bound handle.
    controller.dismiss(live.id);
    // @ts-expect-error A patch never renames the record.
    controller.update(live, { id: 'replacement' });
    void forged;
  }

  // @ts-expect-error Rich content requires an explicit announcement string.
  controller.show({ title: 'Missing speech', description: { kind: 'rich', content: slot } });
  // @ts-expect-error Arbitrary React content is not a command or navigation action.
  controller.show({ title: 'Invalid action', action: slot });
  // @ts-expect-error Track does not deduplicate independent operations.
  controller.track(Promise.resolve(1), { pending: { title: 'Loading' }, success: { title: 'Done' }, error: { title: 'Failed' }, dedupeKey: 'same' });
  // @ts-expect-error Pending operation has no TTL.
  controller.track(Promise.resolve(1), { pending: { title: 'Loading', duration: 200 }, success: { title: 'Done' }, error: { title: 'Failed' } });
  // @ts-expect-error Snapshots are immutable.
  controller.getSnapshot().notifications.push({});
  // @ts-expect-error There is no public host attachment API.
  controller.attach();
  // @ts-expect-error Presentation modes were removed in rc.1.
  const legacyMode: ToasterProps = { mode: 'island' };
  // @ts-expect-error Attention accepts only auto, open or stack.
  controller.show({ title: 'Invalid attention', attention: 'always' });
  // @ts-expect-error timeScale is a number.
  const textScale: ToasterProps = { motion: { timeScale: 'slow' } };
  const motionOptions: ToasterMotion = { timeScale: 0.1 };
  const tuned = (constants: CloudletMotionConstants): CloudletMotionOverrides => ({ ...constants, enter: { duration: constants.enter.duration * 2 } });
  // @ts-expect-error Overrides are numbers, never CSS strings.
  const textOverride: CloudletMotionOverrides = { blur: '6px' };
  // @ts-expect-error The swipe thresholds are not a tuning channel.
  const swipeOverride: CloudletMotionOverrides = { swipe: { intent: 4 } };
  const part: CloudletPart = 'overflow';
  // @ts-expect-error Parts are the fixed CloudletPart names.
  const unknownPart: ToasterProps = { classNames: { card: 'x' } };
  void legacyMode; void textScale; void motionOptions; void tuned; void textOverride; void swipeOverride; void part; void unknownPart;
  void [providerComponent, toasterComponent, controllerHook, optionalHook, pendingProvider, directController];
  return { provider, operationAdmission, businessResult, nativeSignal, toaster };
}

export function verifyRuntimeFactory(slot: ReactNode) {
  const controller: ReactCloudletController = createCloudlet();
  const admission = controller.show({
    title: 'Saved',
    description: { kind: 'rich', content: slot, announcement: 'Saved' },
  });
  if (admission.status !== 'rejected') controller.dismiss(admission.handle);
  const operation = controller.track(({ signal }) => {
    const nativeSignal: AbortSignal = signal;
    return fetch('/upload', { signal: nativeSignal });
  }, { pending: { title: 'Uploading' }, success: { title: 'Uploaded' }, error: { title: 'Failed' } });
  const result: Promise<Response> = operation.result;
  const finalFactory: CreateCloudlet = createCloudlet;
  const provider: CloudletProviderProps = { controller, children: slot };
  const notifications: NotificationController<ReactNode> = controller;
  // @ts-expect-error The legacy notification-only projection still omits track.
  notifications.track;
  // A form action types its values by the field names it declares.
  controller.show({ title: 'Anna: are you coming?', action: {
    kind: 'form', label: 'Send',
    fields: [{ name: 'reply', kind: 'text', label: 'Reply', required: true }, { name: 'note', kind: 'textarea', label: 'Note' }],
    run: ({ values }) => {
      const typed: string = values.reply + values.note;
      // @ts-expect-error Only declared field names exist on the values.
      void values.replly;
      return typed;
    },
    validate: (values) => values.reply.trim() ? true : { reply: 'Write a reply' },
  } });
  controller.show({ title: 'Form', action: {
    kind: 'form', label: 'Send', fields: [{ name: 'reply', kind: 'text', label: 'Reply' }], run: () => undefined,
    // @ts-expect-error validate names only declared fields.
    validate: () => ({ other: 'No' }),
  } });
  void [finalFactory, provider, result];
  controller.dispose();
}

void Toaster;
export type NoPublicBridge = RendererBridge;
