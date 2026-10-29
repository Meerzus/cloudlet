import type { ReactNode } from 'react';
import type { ControllerOptions } from './contracts/controller.js';
import type { MonotonicClock } from './contracts/internal.js';
import type { ReactCloudletController } from './react.js';
import { createCloudletCore } from './core/controller.js';

/** A lazy web adapter: constructing a controller allocates no timers or listeners. */
function createWebClock(): MonotonicClock {
  return {
    now: () => globalThis.performance.now(),
    schedule(deadline, callback) {
      let cancelled = false;
      let timer: ReturnType<typeof globalThis.setTimeout>;
      const schedule = () => {
        const delay = Math.max(0, deadline - globalThis.performance.now());
        // Browsers clamp longer delays to a signed 32-bit timeout. Re-arm only
        // at that boundary so long explicit durations cannot expire early.
        timer = globalThis.setTimeout(() => {
          if (cancelled) return;
          if (globalThis.performance.now() < deadline) schedule();
          else callback();
        }, Math.min(delay, 2_147_483_647));
      };
      schedule();
      return () => {
        if (cancelled) return;
        cancelled = true;
        globalThis.clearTimeout(timer);
      };
    },
  };
}

/** DOM-free state with lazy native clock and per-attempt cancellation adapters. */
export function createCloudlet(options?: ControllerOptions): ReactCloudletController {
  return createCloudletCore<ReactNode, AbortSignal>(options, {
    clock: createWebClock(),
    createCancellation: () => {
      const controller = new AbortController();
      return { signal: controller.signal, abort: (reason) => controller.abort(reason) };
    },
  });
}
