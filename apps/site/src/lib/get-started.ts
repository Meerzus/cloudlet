import { INSTALL_COMMAND, SHADCN_COMMAND } from './site';

/**
 * Get started (LANDING §9). The snippets are copied verbatim from packages/toast/README.md
 * and registry/README.md, which `npm run check:docs` typechecks against the public API;
 * tests/unit/site-get-started.test.ts fails when they drift apart.
 */

export interface GetStartedTab {
  readonly id: 'npm' | 'shadcn';
  readonly label: string;
  readonly command: string;
  readonly commandNote: string;
  readonly file: string;
  readonly codeNote: string;
  readonly code: string;
  /** Where the snippet comes from (repository path). */
  readonly source: string;
}

export const NPM_EXAMPLE = `import '@cloudlet/toast/styles.css';
import { CloudletProvider, createCloudlet, Toaster, useCloudlet } from '@cloudlet/toast';

function SaveNotice() {
  const cloudlet = useCloudlet();
  return <button onClick={() => cloudlet.show({ title: 'Saved', kind: 'success' })}>Notify</button>;
}

// The browser application bootstrap creates and owns this controller.
export function Notifications({ controller }: { controller: ReturnType<typeof createCloudlet> }) {
  return <CloudletProvider controller={controller}>
    <SaveNotice />
    <Toaster />
  </CloudletProvider>;
}`;

export const SHADCN_EXAMPLE = `"use client";

import { useEffect, useState } from "react";
import {
  createCloudlet,
  useOptionalCloudlet,
  type ReactCloudletController,
} from "@cloudlet/toast";
import { Toaster } from "@/components/ui/toaster";

function SaveButton() {
  const controller = useOptionalCloudlet();
  return (
    <button
      disabled={!controller}
      onClick={() => controller?.show({ title: "Saved", kind: "success" })}
    >
      Notify
    </button>
  );
}

export function NotificationOwner() {
  const [controller, setController] = useState<ReactCloudletController | null>(null);
  useEffect(() => {
    const instance = createCloudlet();
    setController(instance);
    return () => instance.dispose();
  }, []);
  // null on the server and in the first client render: the button renders, the Toaster waits.
  return <Toaster controller={controller}><SaveButton /></Toaster>;
}`;

export const GET_STARTED: readonly GetStartedTab[] = [
  {
    id: 'npm',
    label: 'npm',
    command: INSTALL_COMMAND,
    commandNote: 'Add the package. React 18 or 19, nothing else to configure.',
    file: 'notifications.tsx',
    codeNote: 'Import the styles once, mount one Toaster per controller, call show from anywhere below it.',
    code: NPM_EXAMPLE,
    source: 'packages/toast/README.md',
  },
  {
    id: 'shadcn',
    label: 'shadcn',
    command: SHADCN_COMMAND,
    commandNote: 'Adds a thin Toaster wrapper and a CSS bridge to your shadcn tokens, plus the package itself.',
    file: 'notification-owner.tsx',
    codeNote: 'A client component owns the controller; the wrapper lives in components/ui and is yours to edit.',
    code: SHADCN_EXAMPLE,
    source: 'registry/README.md',
  },
];
