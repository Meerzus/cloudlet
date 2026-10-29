import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { LazyMotion, domAnimation, m } from 'motion/react';
import { CloudletFixture } from './cloudlet-content.mjs';

createRoot(document.getElementById('root')).render(
  createElement(LazyMotion, { features: domAnimation, strict: true },
    createElement(m.div, { initial: { opacity: 0 }, animate: { opacity: 1 } }, createElement(CloudletFixture)),
  ),
);
