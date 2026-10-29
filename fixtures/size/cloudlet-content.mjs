import { createElement } from 'react';
import { CloudletProvider, createCloudlet, Toaster, useCloudlet } from '@cloudlet/toast';
import '@cloudlet/toast/styles.css';

const controller = createCloudlet();
const admission = controller.show({ title: 'Saved', kind: 'success' });
const operation = controller.track(() => Promise.resolve('Uploaded'), {
  pending: { title: 'Uploading' }, success: (title) => ({ title }), error: { title: 'Upload failed' },
});
globalThis.__cloudletSizeFixture = { controller, admission, operation };

function Controls() {
  const notifications = useCloudlet();
  return createElement('button', {
    onClick: () => notifications.show({ title: 'Saved', kind: 'success' }),
  }, 'Show notification');
}

export function CloudletFixture() {
  return createElement(CloudletProvider, { controller },
    createElement(Controls),
    createElement(Toaster),
  );
}
