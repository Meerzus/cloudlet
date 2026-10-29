import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { CloudletFixture } from './cloudlet-content.mjs';

createRoot(document.getElementById('root')).render(createElement(CloudletFixture));
