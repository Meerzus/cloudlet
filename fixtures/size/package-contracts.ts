import type {
  AdmissionResult,
  CloudletProviderProps,
  CloudletProviderComponent,
  CreateCloudlet,
  NotificationController,
  NotificationHandle,
  NotificationSpec,
  ReactCloudletController,
  ToasterProps,
  ToasterComponent,
  UseCloudlet,
} from '@cloudlet/toast';
import { CloudletProvider, createCloudlet, Toaster, useCloudlet } from '@cloudlet/toast';
import { createElement, type ReactNode } from 'react';

// Compile the actual runtime factory against packed declarations, without source aliases.
const create: CreateCloudlet = createCloudlet;
const spec: NotificationSpec = { title: 'Saved', description: { kind: 'text', text: 'Complete' } };
const controller: ReactCloudletController = create();
const provider: CloudletProviderProps = { controller };
void provider;
const operation = controller.track(({ signal }) => {
  const nativeSignal: AbortSignal = signal;
  return fetch('/fixture', { signal: nativeSignal });
}, {
  pending: { title: 'Loading' },
  success: (response) => ({ title: String(response.status) }),
  error: { title: 'Failed' },
});
const businessResult: Promise<Response> = operation.result;
void businessResult;
const admission: AdmissionResult = controller.show(spec);
if (admission.status !== 'rejected') {
  const handle: NotificationHandle = admission.handle;
  controller.update(handle, { title: 'Updated' });
}
const toaster: ToasterProps = { attention: { delay: 600 }, offsets: { obstruction: { bottom: 24 } } };
void toaster;
const providerComponent: CloudletProviderComponent = CloudletProvider;
const toasterComponent: ToasterComponent = Toaster;
const controllerHook: UseCloudlet = useCloudlet;
const tree = createElement(CloudletProvider, { controller }, createElement(Toaster, toaster));
void [providerComponent, toasterComponent, controllerHook, tree];

// @ts-expect-error Toaster receives its controller only from CloudletProvider.
const directController: ToasterProps = { controller };
void directController;

// @ts-expect-error Opaque handles cannot be reconstructed by consumers.
const forgedHandle: NotificationHandle = { id: 'name', controller: 'owner', generation: 'generation' };
void forgedHandle;

// @ts-expect-error Internal controller/renderer types are not root public exports.
import type { HostLease } from '@cloudlet/toast';

const notifications: NotificationController<ReactNode> = createCloudlet();
notifications.show({ title: 'Ready', description: { kind: 'rich', content: 'Content', announcement: 'Content' } });
// @ts-expect-error The notification-only projection intentionally omits track.
notifications.track;
const finalFactory: CreateCloudlet = createCloudlet;
void finalFactory;
notifications.dispose();
