import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Consumer } from './consumer';
import '@cloudlet/toast/styles.css';
import './consumer.css';
createRoot(document.getElementById('root')!).render(<StrictMode><Consumer nonce={document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content ?? ''} /></StrictMode>);
