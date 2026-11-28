import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAgent, type Agent } from '@cloudlet/agent';
import type { ReactCloudletController } from '@cloudlet/toast';
import { toasterAgent } from '@cloudlet/toast/agent';
import { Consumer } from './consumer';
import '@cloudlet/toast/styles.css';
import './consumer.css';

declare global { interface Window { cloudletAgent?: Agent; } }

// The bridge from its own archive reads and drives the app's primary controller; the test reaches it on `window`.
function connectAgent(controller: ReactCloudletController) {
  const agent = createAgent();
  const disconnect = agent.connect(toasterAgent(controller));
  window.cloudletAgent = agent;
  return () => { disconnect(); if (window.cloudletAgent === agent) delete window.cloudletAgent; };
}

createRoot(document.getElementById('root')!).render(<StrictMode><Consumer nonce={document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content ?? ''} connect={connectAgent} /></StrictMode>);
