import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')).render(
  createElement('div', null, 'Cloudlet size fixture'),
);
