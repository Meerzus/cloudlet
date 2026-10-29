import * as React from 'react';
import { transformWithOxc } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactCloudletController } from '@cloudlet/toast';
import { DEMO_GROUPS, DEMOS, demosIn, findDemo } from '../../apps/site/src/lib/demos';

type Call = readonly unknown[];

/** Function-free, handle-free shape of an argument (React elements as type + props), so two runs can be compared. */
function shape(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'function') return '[function]';
      if (React.isValidElement(item)) {
        const { type, props } = item;
        return { element: typeof type === 'symbol' ? String(type) : type, props };
      }
      return item;
    }),
  );
}

/** The snippet as visitors copy it, compiled (JSX → createElement) and run with `cloudlet` in scope. */
async function compile(snippet: string) {
  const { code } = await transformWithOxc(snippet, 'snippet.jsx', {
    jsx: { runtime: 'classic', pragma: 'React.createElement', pragmaFrag: 'React.Fragment' },
  });
  const run = new Function('cloudlet', 'React', code) as (cloudlet: ReactCloudletController, react: typeof React) => void;
  return (cloudlet: ReactCloudletController) => run(cloudlet, React);
}

/**
 * A controller that records every public call. Command actions are pressed (and
 * pressed again if they fail, as Retry does), tracked factories run twice (the
 * first attempt, then Retry) and tracked promises are awaited, so nested calls
 * and per-attempt behaviour are part of the comparison.
 */
function recordingController() {
  const calls: Call[] = [];
  const work: Promise<unknown>[] = [];
  let handles = 0;
  const handle = () => ({ id: `h${(handles += 1)}` });
  const controller = {
    show(spec: { action?: { kind: string; run?: (context: unknown) => unknown } }) {
      calls.push(['show', shape(spec)]);
      const created = handle();
      const action = spec.action;
      if (action?.kind === 'command' && action.run) {
        const press = action.run;
        work.push(
          Promise.resolve().then(async () => {
            for (const attempt of [1, 2]) {
              try {
                await press({ handle: created, token: {} });
                calls.push(['action', attempt, 'fulfilled']);
                return;
              } catch (error) {
                calls.push(['action', attempt, 'rejected', String(error)]);
              }
            }
          }),
        );
      }
      return { status: 'created', handle: created };
    },
    update(target: { id: string }, patch: unknown) {
      calls.push(['update', target.id, shape(patch)]);
      return { status: 'applied' };
    },
    track(source: PromiseLike<unknown> | ((context: unknown) => unknown), options: unknown) {
      calls.push(['track', typeof source === 'function' ? 'factory' : 'promise', shape(options)]);
      const created = handle();
      const settle = async (attempt: number, run: () => unknown) => {
        try {
          await run();
          calls.push(['settled', attempt, 'fulfilled']);
        } catch (error) {
          calls.push(['settled', attempt, 'rejected', String(error)]);
        }
      };
      work.push(
        Promise.resolve().then(async () => {
          if (typeof source !== 'function') return settle(1, () => source);
          for (const attempt of [1, 2]) {
            await settle(attempt, () => source({ signal: new AbortController().signal, attempt, token: {} }));
          }
        }),
      );
      return { admission: { status: 'created', handle: created } };
    },
    clear() {
      calls.push(['clear']);
      return { status: 'cleared', count: 0 };
    },
    acknowledgeOverflow() {
      calls.push(['acknowledgeOverflow']);
      return { status: 'unchanged' };
    },
  };
  return { controller: controller as unknown as ReactCloudletController, calls, work };
}

async function record(execute: (controller: ReactCloudletController) => void) {
  const { controller, calls, work } = recordingController();
  execute(controller);
  // Let timers, nested actions and attempts finish (work can grow while running).
  for (let settled = 0; settled < work.length; ) {
    const batch = work.slice(settled);
    await vi.runAllTimersAsync();
    await Promise.all(batch);
    settled += batch.length;
  }
  await vi.runAllTimersAsync();
  return calls;
}

describe('site demo catalog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('has unique ids', () => {
    const ids = DEMOS.map((demo) => demo.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(findDemo(id)?.id).toBe(id);
  });

  it('covers every playground group', () => {
    expect(DEMO_GROUPS.map((group) => group.id)).toEqual(['Kinds', 'Content', 'Actions', 'Promises', 'Attention', 'Stack']);
    const counts = Object.fromEntries(DEMO_GROUPS.map((group) => [group.id, demosIn(group.id).length]));
    expect(counts).toEqual({ Kinds: 5, Content: 4, Actions: 3, Promises: 5, Attention: 3, Stack: 3 });
  });

  it.each(DEMOS.map((demo) => [demo.id, demo] as const))('snippet of %s makes exactly the calls of its run', async (_id, demo) => {
    const expected = await record(demo.run);
    // The snippet is the text visitors copy; it runs as plain JavaScript with `cloudlet` in scope.
    const actual = await record(await compile(demo.snippet));
    expect(expected.length).toBeGreaterThan(0);
    expect(actual).toEqual(expected);
  });

  it('notices a snippet that drifts from its call', async () => {
    const demo = findDemo('success');
    if (!demo) throw new Error('missing demo');
    const drifted = await compile(demo.snippet.replace('Synced', 'Saved'));
    expect(await record(drifted)).not.toEqual(await record(demo.run));
  });

  it('notices a drift inside rich content', async () => {
    const demo = findDemo('rich-description');
    if (!demo) throw new Error('missing demo');
    const drifted = await compile(demo.snippet.replace('<strong>10,000 m</strong>', '<b>10,000 m</b>'));
    expect(await record(drifted)).not.toEqual(await record(demo.run));
  });
});
