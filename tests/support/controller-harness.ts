import type { CloudletController, ControllerOptions } from '../../packages/toast/src/contracts/controller.js';
import type { NotificationHandle } from '../../packages/toast/src/contracts/identity.js';
import type { HostLease, HostOptions, MonotonicClock, RendererBridge } from '../../packages/toast/src/contracts/internal.js';
import type { NotificationSpec } from '../../packages/toast/src/contracts/notifications.js';
import { getRendererBridge } from '../../packages/toast/src/core/bridge.js';
import { createCloudletCore } from '../../packages/toast/src/core/controller.js';
import { ManualClock } from './manual-clock.js';

export type Core = CloudletController<unknown, AbortSignal>;
export type Bridge = RendererBridge<unknown>;

export function createCancellation() {
  const controller = new AbortController();
  return { signal: controller.signal, abort: (reason?: unknown) => controller.abort(reason) };
}

export function harness(options?: ControllerOptions, clock = new ManualClock()) {
  const controller = createCloudletCore<unknown, AbortSignal>(options, { clock, createCancellation });
  return { controller, bridge: getRendererBridge(controller), clock };
}

export function admit(controller: Core, spec: NotificationSpec<unknown> | string): NotificationHandle {
  const result = controller.show(typeof spec === 'string' ? { title: spec, id: spec } : spec);
  if (result.status !== 'created') throw new Error(`Expected creation, received ${result.status}`);
  return result.handle;
}

export function attach(bridge: Bridge, options?: HostOptions): HostLease {
  const result = bridge.attach(options);
  if (result.status !== 'attached') throw new Error(`Expected attachment, received ${result.reason}`);
  return result.lease;
}

export function acknowledge(bridge: Bridge, lease: HostLease, handle: NotificationHandle): void {
  const token = presentation(bridge, handle);
  const result = bridge.acknowledgePresentation(lease, handle, token);
  if (result.status === 'rejected') throw new Error(`Expected presentation acknowledgement, received ${result.reason}`);
}

export function presentation(bridge: Bridge, handle: NotificationHandle) {
  const current = bridge.getSnapshot().presentation;
  if (current?.handle !== handle || !current.token) throw new Error(`Missing presentation for ${handle.id}`);
  return current.token;
}

/** Handles of the presented record (at most one), for compact assertions. */
export function current(controller: Core) {
  return controller.getSnapshot().notifications.filter((item) => item.location === 'current').map((item) => item.handle);
}

export function record(controller: Core, handle: NotificationHandle) {
  const result = controller.getSnapshot().notifications.find((item) => item.handle === handle);
  if (!result) throw new Error(`Missing record ${handle.id}`);
  return result;
}

/** Delivers canceled callbacks on demand, as a delayed platform timer may do. */
export class RetainedCallbackClock implements MonotonicClock {
  readonly manual = new ManualClock();
  readonly callbacks: (() => void)[] = [];
  readonly now = this.manual.now;
  readonly schedule = (deadline: number, callback: () => void) => {
    this.callbacks.push(callback);
    return this.manual.schedule(deadline, callback);
  };
}
