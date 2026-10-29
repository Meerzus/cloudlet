import { describe, expect, it } from 'vitest';
import { createDeferred } from '../support/deferred.js';
import { runEventSequence, type EventStep } from '../support/event-sequence.js';
import { ManualClock } from '../support/manual-clock.js';

describe('ManualClock', () => {
  it('runs deadlines chronologically with stable ties and exposes pending work', () => {
    const clock = new ManualClock({ initialTime: 20 });
    const events: string[] = [];
    clock.schedule(50, () => events.push(`last:${clock.now()}`));
    clock.schedule(30, () => events.push(`first:${clock.now()}`));
    clock.schedule(30, () => events.push(`second:${clock.now()}`));

    expect(clock.pendingCount).toBe(3);
    expect(clock.nextDeadline).toBe(30);
    clock.advanceTo(29);
    expect(events).toEqual([]);
    clock.advanceBy(1);
    expect(events).toEqual(['first:30', 'second:30']);
    expect(clock.pendingCount).toBe(1);
    expect(clock.nextDeadline).toBe(50);
    clock.advanceTo(100);
    expect(events).toEqual(['first:30', 'second:30', 'last:50']);
    expect(clock.now()).toBe(100);
    expect(clock.pendingCount).toBe(0);
    expect(clock.nextDeadline).toBeUndefined();
  });

  it('defers already-due deadlines until an explicit advance', () => {
    const clock = new ManualClock({ initialTime: 10 });
    const events: number[] = [];
    clock.schedule(-5, () => events.push(clock.now()));
    clock.schedule(10, () => events.push(clock.now()));
    expect(events).toEqual([]);
    clock.advanceBy(0);
    expect(events).toEqual([10, 10]);
  });

  it('cancels idempotently, including after a callback has fired', () => {
    const clock = new ManualClock();
    const events: string[] = [];
    const cancel = clock.schedule(1, () => events.push('canceled'));
    const cancelAfterFiring = clock.schedule(2, () => events.push('fired'));
    cancel();
    cancel();
    expect(clock.pendingCount).toBe(1);
    clock.advanceTo(2);
    cancelAfterFiring();
    cancelAfterFiring();
    expect(events).toEqual(['fired']);
    expect(clock.pendingCount).toBe(0);
  });

  it('includes newly scheduled deadlines and respects cancellation during a callback', () => {
    const clock = new ManualClock();
    const events: string[] = [];
    clock.schedule(10, () => {
      events.push('first');
      cancelLater();
      clock.schedule(10, () => events.push('new-same-time'));
      clock.schedule(15, () => events.push('new-later'));
    });
    clock.schedule(10, () => events.push('existing-same-time'));
    const cancelLater = clock.schedule(20, () => events.push('canceled'));

    clock.advanceTo(30);
    expect(events).toEqual(['first', 'existing-same-time', 'new-same-time', 'new-later']);
    expect(clock.now()).toBe(30);
  });

  it('stops at a thrown callback and can resume remaining work', () => {
    const clock = new ManualClock();
    const failure = new Error('scheduled failure');
    const events: number[] = [];
    clock.schedule(4, () => { throw failure; });
    clock.schedule(5, () => events.push(clock.now()));

    expect(() => clock.advanceTo(10)).toThrow(failure);
    expect(clock.now()).toBe(4);
    expect(clock.pendingCount).toBe(1);
    clock.advanceTo(10);
    expect(events).toEqual([5]);
    expect(clock.now()).toBe(10);
  });

  it('rejects time travel, non-finite times and recursive advancement', () => {
    const clock = new ManualClock({ initialTime: 10 });
    expect(() => clock.advanceTo(9)).toThrow(RangeError);
    expect(() => clock.advanceBy(-1)).toThrow(RangeError);
    expect(() => clock.advanceTo(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => clock.schedule(Number.NaN, () => undefined)).toThrow(RangeError);
    clock.schedule(11, () => clock.advanceTo(12));
    expect(() => clock.advanceTo(13)).toThrow('Clock cannot advance recursively');
    expect(clock.now()).toBe(11);
    clock.advanceTo(13);
    expect(clock.now()).toBe(13);
  });

  it('fails fast on an infinite same-deadline loop while retaining pending work', () => {
    const clock = new ManualClock({ maxCallbacksPerAdvance: 3 });
    let executions = 0;
    const repeat = (): void => {
      executions++;
      clock.schedule(clock.now(), repeat);
    };
    clock.schedule(1, repeat);

    expect(() => clock.advanceTo(10)).toThrow('Manual clock callback limit exceeded');
    expect(executions).toBe(3);
    expect(clock.now()).toBe(1);
    expect(clock.pendingCount).toBe(1);
  });

  it('keeps native promise continuations outside synchronous clock advancement', async () => {
    const clock = new ManualClock();
    const deferred = createDeferred<number>();
    const events: number[] = [];
    const observed = deferred.promise.then((value) => { events.push(value); });
    clock.schedule(1, () => deferred.resolve(42));
    clock.advanceTo(1);
    expect(events).toEqual([]);
    await observed;
    expect(events).toEqual([42]);
  });
});

describe('createDeferred', () => {
  it('stays pending until explicitly fulfilled and only settles once', async () => {
    const deferred = createDeferred<number>();
    const values: number[] = [];
    const observed = deferred.promise.then((value) => { values.push(value); });
    await Promise.resolve();
    expect(values).toEqual([]);
    deferred.resolve(7);
    deferred.resolve(9);
    deferred.reject(new Error('ignored after resolve'));
    await observed;
    expect(values).toEqual([7]);
  });

  it('preserves rejection identity and ignores later fulfillment', async () => {
    const deferred = createDeferred<number>();
    const failure = new Error('operation failure');
    const observed = deferred.promise.catch((reason: unknown) => reason);
    deferred.reject(failure);
    deferred.resolve(1);
    expect(await observed).toBe(failure);
  });

  it('adopts another promise using native first-settlement semantics', async () => {
    const outer = createDeferred<number>();
    const inner = createDeferred<number>();
    outer.resolve(inner.promise);
    outer.reject(new Error('ignored after adopting pending promise'));
    inner.resolve(8);
    await expect(outer.promise).resolves.toBe(8);
  });
});

describe('runEventSequence', () => {
  it('replays the same script deterministically, including timers and deferred results', async () => {
    interface Context {
      readonly clock: ManualClock;
      readonly deferred: ReturnType<typeof createDeferred<string>>;
      readonly events: string[];
      observed?: Promise<void>;
    }
    const steps: readonly EventStep<Context>[] = [
      {
        at: 0,
        name: 'begin',
        run: (context) => {
          context.observed = context.deferred.promise.then((value) => {
            context.events.push(`${value}:${context.clock.now()}`);
          });
          context.clock.schedule(5, () => context.events.push('timer:5'));
        },
      },
      {
        at: 5,
        name: 'resolve',
        run: (context) => {
          context.events.push('resolve:5');
          context.deferred.resolve('fulfilled');
        },
      },
      {
        at: 5,
        name: 'observe',
        run: async (context) => { await context.observed; },
      },
      { at: 8, name: 'end', run: (context) => { context.events.push('end:8'); } },
    ];
    const replay = async () => {
      const context: Context = {
        clock: new ManualClock(),
        deferred: createDeferred<string>(),
        events: [],
      };
      const trace = await runEventSequence(context.clock, context, steps);
      return { trace, events: context.events, time: context.clock.now() };
    };

    const first = await replay();
    const second = await replay();
    expect(first).toEqual(second);
    expect(first.events).toEqual(['timer:5', 'resolve:5', 'fulfilled:5', 'end:8']);
    expect(first.trace.map(({ name }) => name)).toEqual(['begin', 'resolve', 'observe', 'end']);
    expect(first.time).toBe(8);
    expect(Object.isFrozen(first.trace)).toBe(true);
  });

  it('validates the entire timeline before performing any step', async () => {
    const clock = new ManualClock();
    const events: string[] = [];
    await expect(runEventSequence(clock, events, [
      { at: 2, name: 'would run', run: (context) => { context.push('ran'); } },
      { at: 1, name: 'invalid', run: () => undefined },
    ])).rejects.toThrow(RangeError);
    expect(events).toEqual([]);
    expect(clock.now()).toBe(0);
  });

  it('returns awaited step results and propagates failures before subsequent steps', async () => {
    const clock = new ManualClock();
    const trace = await runEventSequence(clock, 2, [
      { at: 1, name: 'double', run: async (value) => value * 2 },
      { at: 1, name: 'triple', run: (value) => value * 3 },
    ]);
    expect(trace).toEqual([
      { at: 1, name: 'double', result: 4 },
      { at: 1, name: 'triple', result: 6 },
    ]);
    const failure = new Error('step failed');
    const events: string[] = [];
    await expect(runEventSequence(clock, events, [
      { at: 2, name: 'fail', run: async () => { throw failure; } },
      { at: 3, name: 'unreachable', run: (context) => { context.push('ran'); } },
    ])).rejects.toBe(failure);
    expect(events).toEqual([]);
    expect(clock.now()).toBe(2);
  });
});
