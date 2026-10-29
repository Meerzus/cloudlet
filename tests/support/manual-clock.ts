import type { MonotonicClock } from '../../packages/toast/src/contracts/internal.js';

interface ScheduledCallback {
  readonly id: number;
  readonly deadline: number;
  readonly callback: () => void;
}

export interface ManualClockOptions {
  readonly initialTime?: number;
  /** Fail fast on callbacks that schedule themselves forever at the same time. */
  readonly maxCallbacksPerAdvance?: number;
}

/**
 * Monotonic, manually advanced test clock. Scheduling never invokes a callback.
 * Past deadlines become due at now(); equal deadlines run in insertion order.
 * Callbacks may schedule/cancel other callbacks, but cannot recursively advance.
 * A callback error stops advancement at its deadline and leaves later work pending.
 * Promise microtasks remain native and must be awaited explicitly by a test.
 */
export class ManualClock implements MonotonicClock {
  #time: number;
  #nextId = 0;
  #advancing = false;
  readonly #callbacks = new Map<number, ScheduledCallback>();
  readonly #maxCallbacksPerAdvance: number;

  constructor(options: ManualClockOptions = {}) {
    const initialTime = options.initialTime ?? 0;
    assertFinite(initialTime, 'initialTime');
    if (initialTime < 0) throw new RangeError('initialTime must be non-negative');

    const maxCallbacks = options.maxCallbacksPerAdvance ?? 10_000;
    if (!Number.isSafeInteger(maxCallbacks) || maxCallbacks < 1) {
      throw new RangeError('maxCallbacksPerAdvance must be a positive safe integer');
    }

    this.#time = initialTime;
    this.#maxCallbacksPerAdvance = maxCallbacks;
  }

  readonly now = (): number => this.#time;

  readonly schedule = (deadline: number, callback: () => void): (() => void) => {
    assertFinite(deadline, 'deadline');
    const id = this.#nextId++;
    this.#callbacks.set(id, {
      id,
      deadline: Math.max(this.#time, deadline),
      callback,
    });
    return () => {
      this.#callbacks.delete(id);
    };
  };

  get pendingCount(): number {
    return this.#callbacks.size;
  }

  get nextDeadline(): number | undefined {
    return this.#nextCallback()?.deadline;
  }

  advanceBy(milliseconds: number): void {
    assertFinite(milliseconds, 'milliseconds');
    if (milliseconds < 0) throw new RangeError('milliseconds must be non-negative');
    this.advanceTo(this.#time + milliseconds);
  }

  advanceTo(target: number): void {
    assertFinite(target, 'target');
    if (target < this.#time) throw new RangeError('Clock cannot move backwards');
    if (this.#advancing) throw new Error('Clock cannot advance recursively');

    this.#advancing = true;
    let executed = 0;
    try {
      let next = this.#nextCallback();
      while (next !== undefined && next.deadline <= target) {
        if (executed >= this.#maxCallbacksPerAdvance) {
          throw new Error('Manual clock callback limit exceeded');
        }
        this.#time = next.deadline;
        this.#callbacks.delete(next.id);
        executed++;
        next.callback();
        next = this.#nextCallback();
      }
      this.#time = target;
    } finally {
      this.#advancing = false;
    }
  }

  #nextCallback(): ScheduledCallback | undefined {
    let next: ScheduledCallback | undefined;
    for (const candidate of this.#callbacks.values()) {
      if (
        next === undefined ||
        candidate.deadline < next.deadline ||
        (candidate.deadline === next.deadline && candidate.id < next.id)
      ) {
        next = candidate;
      }
    }
    return next;
  }
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}
