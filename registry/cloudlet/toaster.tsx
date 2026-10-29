"use client";

import {
  CloudletProvider,
  Toaster as CloudletToaster,
  type ReactCloudletController,
  type ToasterProps as CloudletToasterProps,
} from "@cloudlet/toast";
import type { ReactNode } from "react";
import "@cloudlet/toast/styles.css";
import "./toaster.css";

export interface ToasterProps extends CloudletToasterProps {
  /**
   * The application owns this instance and disposes it when its owner unmounts.
   * `null` until the owner creates it: children render, the Toaster waits.
   */
  controller: ReactCloudletController | null;
  children?: ReactNode;
}

/** A local theme adapter. All notification behavior stays in @cloudlet/toast. */
export function Toaster({ controller, children, ...options }: ToasterProps) {
  return (
    <CloudletProvider controller={controller}>
      {children}
      <CloudletToaster {...options} />
    </CloudletProvider>
  );
}
