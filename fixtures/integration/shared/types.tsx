import { CloudletProvider, createCloudlet, Toaster, useCloudlet } from '@cloudlet/toast';
import type { ReactCloudletController, NotificationHandle } from '@cloudlet/toast';
import '@cloudlet/toast/styles.css';
const controller: ReactCloudletController = createCloudlet();
const result = controller.show({ title: 'Types', duration: null, description: { kind: 'rich', content: <strong>Rich</strong>, announcement: 'Rich' } });
if (result.status !== 'rejected') { const handle: NotificationHandle = result.handle; controller.update(handle, { progress: { kind: 'determinate', value: 0.5 } }); }
controller.track(({ signal }) => { const native: AbortSignal = signal; return fetch('https://example.invalid', { signal: native }); }, { pending: { title: 'Loading' }, success: { title: 'Done' }, error: { title: 'Error' } }).result.catch(() => {});
function Probe() { const owned: ReactCloudletController = useCloudlet(); return <CloudletProvider controller={owned}><Toaster nonce="example" dir="rtl" attention={{ delay: 600 }} /></CloudletProvider>; }
void Probe;
// @ts-expect-error Internal imports are intentionally absent from package exports.
import { internal } from '@cloudlet/toast/dist/core/controller.js';
void internal;
