import type { ManualClock } from './manual-clock.js';

export interface EventStep<Context, Result = void> {
  /** Absolute clock time. Equal-time steps preserve array order. */
  readonly at: number;
  readonly name: string;
  readonly run: (context: Context) => Result | PromiseLike<Result>;
}

export interface EventTrace<Result> {
  readonly at: number;
  readonly name: string;
  readonly result: Result;
}

/**
 * Replays a fully validated sequence against a caller-owned context.
 * Due timer callbacks run before the step at the same timestamp. Each step is
 * awaited before the next step. Do not return a promise that only a later step
 * can settle; register its observer and settle it in that later step instead.
 * A step failure propagates immediately; the caller owns cleanup and assertions.
 */
export async function runEventSequence<Context, Result = void>(
  clock: ManualClock,
  context: Context,
  steps: readonly EventStep<Context, Result>[],
): Promise<readonly EventTrace<Result>[]> {
  let previousTime = clock.now();
  for (const step of steps) {
    if (!Number.isFinite(step.at) || step.at < previousTime) {
      throw new RangeError('Event sequence times must be finite and non-decreasing');
    }
    previousTime = step.at;
  }

  const trace: EventTrace<Result>[] = [];
  for (const step of steps) {
    clock.advanceTo(step.at);
    const result = await step.run(context);
    trace.push(Object.freeze({ at: step.at, name: step.name, result }));
  }
  return Object.freeze(trace);
}
