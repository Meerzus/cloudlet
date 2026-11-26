import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAgent, type ActResult, type AgentComponent, type AgentEntry, type AgentRunContext, type AgentRunOutcome,
  type AgentStepCall, type AgentStepCheck, type Allow,
} from '@cloudlet/agent';

type Check = (step: AgentStepCall) => AgentStepCheck;
type Run = (step: AgentStepCall, context: AgentRunContext) => AgentRunOutcome | PromiseLike<AgentRunOutcome>;

interface Spec {
  readonly entries?: AgentEntry[];
  readonly check?: Check;
  readonly run?: Run;
  readonly summon?: (step: AgentStepCall) => boolean;
}

/** A stand-in for an adapter that takes steps: every method is a spy with a default answer. */
function stepper(name = 'box', spec: Spec = {}) {
  let records: readonly AgentEntry[] = spec.entries ?? [
    { ref: name, component: 'box', actions: ['clear'] },
    { ref: `${name}:1`, component: 'item', actions: ['dismiss', 'press'] },
  ];
  const listeners = new Set<() => void>();
  const check = vi.fn<Check>(spec.check ?? (() => ({ available: true, permission: 'allow' })));
  const run = vi.fn<Run>(spec.run ?? (() => ({ status: 'done' })));
  const summon = vi.fn<(step: AgentStepCall) => boolean>(spec.summon ?? (() => true));
  const component: AgentComponent = {
    protocol: 1,
    name,
    snapshot: () => records,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    check,
    run,
    summon,
  };
  return {
    component, check, run, summon,
    set(next: AgentEntry[]) { records = next; for (const listener of [...listeners]) listener(); },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks run without touching timers. */
const settle = async (): Promise<void> => { for (let index = 0; index < 10; index++) await Promise.resolve(); };

const confirm: Check = () => ({ available: true, permission: 'confirm', names: { target: 'Undo', within: 'File deleted' } });
const deny: Check = () => ({ available: true, permission: 'deny', names: { target: 'Delete', within: 'Draft saved' } });
const press = { steps: [{ ref: 'box:1', action: 'press' }] };

function errorOf(result: ActResult): { step: number; message: string } {
  if (result.ok) throw new Error('Expected a failed call');
  return result.error;
}

/** Collects what the bridge reports through queueMicrotask. */
function captureReports(): unknown[] {
  const reported: unknown[] = [];
  vi.stubGlobal('queueMicrotask', (callback: () => void) => {
    try { callback(); } catch (error) { reported.push(error); }
  });
  return reported;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createAgent options', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '1000', null])('rejects the timeout %j', (timeout) => {
    expect(() => createAgent({ timeout: timeout as number })).toThrow(TypeError);
  });

  it('rejects an allow that is not a function and options that are not an object', () => {
    expect(() => createAgent({ allow: true as unknown as Allow })).toThrow(TypeError);
    expect(() => createAgent(null as never)).toThrow(TypeError);
    expect(() => createAgent({})).not.toThrow();
    expect(() => createAgent({ timeout: 1 })).not.toThrow();
  });

  it('rejects step methods that come without each other or are not functions', () => {
    const agent = createAgent();
    const { check: _check, ...withoutCheck } = stepper('one').component;
    void _check;
    expect(() => agent.connect(withoutCheck)).toThrow(TypeError);
    expect(() => agent.connect({ ...stepper('two').component, summon: 1 as never })).toThrow(TypeError);
    expect(() => agent.connect({ ...stepper('three').component, run: 'go' as never })).toThrow(TypeError);
    expect(agent.snapshot()).toEqual([]);
  });
});

describe('act: the shape of the call', () => {
  it.each([
    [undefined, 0, 'Invalid call: expected an object with steps. No step ran.'],
    [[], 0, 'Invalid call: expected an object with steps. No step ran.'],
    [{ steps: [], extra: 1 }, 0, 'Invalid call: unknown key "extra". No step ran.'],
    [{ steps: [] }, 0, 'Invalid call: steps must be a non-empty array. No step ran.'],
    [{ steps: 'clear' }, 0, 'Invalid call: steps must be a non-empty array. No step ran.'],
    [{ steps: [{ ref: 'box', action: 'clear' }, null] }, 1, 'Invalid call: steps[1] must be an object. No step ran.'],
    [{ steps: [{ ref: 'box', action: 'clear' }, { ref: 'box', action: 7 }] }, 1, 'Invalid call: steps[1].action must be a string. No step ran.'],
    [{ steps: [{ ref: 3, action: 'clear' }] }, 0, 'Invalid call: steps[0].ref must be a string. No step ran.'],
    [{ steps: [{ ref: 'box', action: 'clear', args: 'x' }] }, 0, 'Invalid call: steps[0].args must be an array. No step ran.'],
    [{ steps: [{ ref: 'box', action: 'clear', why: 'tidy' }] }, 0, 'Invalid call: steps[0] has an unknown key "why". No step ran.'],
  ])('refuses %j before any step', async (input, step, message) => {
    const box = stepper();
    const agent = createAgent();
    agent.connect(box.component);
    const result = await agent.act(input as never);
    expect(result).toEqual({ ok: false, error: { step, message }, steps: [] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(box.check).not.toHaveBeenCalled();
    expect(box.run).not.toHaveBeenCalled();
  });

  it('checks every step before the first runs', async () => {
    const box = stepper();
    const agent = createAgent();
    agent.connect(box.component);
    const result = await agent.act({ steps: [{ ref: 'box', action: 'clear' }, { ref: 'box' } as never] });
    expect(errorOf(result).message).toBe('Invalid call: steps[1].action must be a string. No step ran.');
    expect(box.run).not.toHaveBeenCalled();
  });

  it('refuses options with a signal that is not one', async () => {
    const agent = createAgent();
    const result = await agent.act({ steps: [{ ref: 'box', action: 'clear' }] }, { signal: {} as never });
    expect(errorOf(result).message).toBe('Invalid call: options.signal must be an AbortSignal. No step ran.');
  });

  it('hands the component a frozen copy with args always present', async () => {
    const box = stepper();
    const agent = createAgent();
    agent.connect(box.component);
    const args = ['Reply', 'Hi'];
    const pending = agent.act({ steps: [{ ref: 'box', action: 'clear' }, { ref: 'box:1', action: 'fill', args }] });
    args.push('late');
    await pending;
    const [first] = box.check.mock.calls[0]!;
    const [second] = box.check.mock.calls[1]!;
    expect(first).toEqual({ ref: 'box', action: 'clear', args: [] });
    expect(second).toEqual({ ref: 'box:1', action: 'fill', args: ['Reply', 'Hi'] });
    expect(Object.isFrozen(second)).toBe(true);
    expect(Object.isFrozen(second.args)).toBe(true);
    expect(box.run.mock.calls[1]![0]).toBe(second);
  });
});

describe('act: finding the record', () => {
  it('names the stale ref and every current one', async () => {
    const agent = createAgent();
    agent.connect(stepper('toaster', { entries: [
      { ref: 'toaster', component: 'toaster', actions: [] },
      { ref: 'toaster:8', component: 'notification', actions: [] },
      { ref: 'toaster:9', component: 'notification', actions: [] },
    ] }).component);
    const result = await agent.act({ steps: [{ ref: 'toaster:7', action: 'dismiss' }] });
    expect(errorOf(result)).toEqual({ step: 0, message: 'No entry "toaster:7". Current refs: toaster, toaster:8, toaster:9.' });
  });

  it('says so when nothing is connected', async () => {
    const result = await createAgent().act(press);
    expect(errorOf(result).message).toBe('No entry "box:1". Current refs: none.');
  });

  it('reads the component now, not a cached snapshot', async () => {
    const records = [{ ref: 'quiet', component: 'item', actions: ['clear'] }];
    const box = stepper('quiet', { entries: records });
    // A component that changes without telling anyone.
    const silent: AgentComponent = { ...box.component, subscribe: () => () => {} };
    const agent = createAgent();
    agent.connect(silent);
    expect(agent.snapshot()).toHaveLength(1);
    records.push({ ref: 'quiet:1', component: 'item', actions: ['clear'] });
    const result = await agent.act({ steps: [{ ref: 'quiet:1', action: 'clear' }] });
    expect(result.ok).toBe(true);
  });

  it('connects a read-only component and refuses its steps clearly', async () => {
    const agent = createAgent();
    agent.connect({ protocol: 1, name: 'counter', snapshot: () => [{ ref: 'counter', component: 'counter', actions: [] }], subscribe: () => () => {} });
    const result = await agent.act({ steps: [{ ref: 'counter', action: 'increment' }] });
    expect(errorOf(result).message).toBe('"increment" is not available on "counter": its component takes no steps.');
  });
});

describe('act: availability and permission', () => {
  it('lists the available verbs when the component gives no reason', async () => {
    const box = stepper('toaster', {
      entries: [{ ref: 'toaster:3', component: 'notification', actions: ['dismiss', 'show'] }],
      check: () => ({ available: false }),
    });
    const agent = createAgent();
    agent.connect(box.component);
    const result = await agent.act({ steps: [{ ref: 'toaster:3', action: 'press' }] });
    expect(errorOf(result).message).toBe('"press" is not available on "toaster:3" now. Available: dismiss, show.');
    expect(box.run).not.toHaveBeenCalled();
  });

  it("passes the component's own refusal through", async () => {
    const box = stepper('box', { check: () => ({ available: false, message: 'No Toaster is on screen: "show" needs one.' }) });
    const allow = vi.fn(() => true);
    const agent = createAgent({ allow });
    agent.connect(box.component);
    const result = await agent.act({ steps: [{ ref: 'box:1', action: 'show' }] });
    expect(errorOf(result).message).toBe('No Toaster is on screen: "show" needs one.');
    expect(allow).not.toHaveBeenCalled();
  });

  it('refuses a denied step without asking allow, whatever it would say', async () => {
    const box = stepper('box', { check: deny });
    const allow = vi.fn(() => true);
    const agent = createAgent({ allow });
    agent.connect(box.component);
    const result = await agent.act(press);
    expect(errorOf(result).message).toBe('Not allowed: the app does not let an agent press "Delete" on "Draft saved". Look for no other way.');
    expect(allow).not.toHaveBeenCalled();
    expect(box.run).not.toHaveBeenCalled();
    expect(box.summon).not.toHaveBeenCalled();
  });

  it('names a denied step by verb and ref when the component gives no names', async () => {
    const box = stepper('box', { check: () => ({ available: true, permission: 'deny' }) });
    const agent = createAgent();
    agent.connect(box.component);
    expect(errorOf(await agent.act(press)).message).toBe('Not allowed: the app does not let an agent run "press" on "box:1". Look for no other way.');
  });

  it('treats an unknown permission as a denial and reports it', async () => {
    const reported = captureReports();
    const box = stepper('box', { check: () => ({ available: true, permission: 'maybe' as never }) });
    const agent = createAgent({ allow: () => true });
    agent.connect(box.component);
    expect(errorOf(await agent.act(press)).message).toMatch(/^Not allowed:/);
    expect(box.run).not.toHaveBeenCalled();
    expect(reported).toHaveLength(1);
  });

  it('reports a check that throws and runs nothing', async () => {
    const reported = captureReports();
    const failure = new Error('check broke');
    const box = stepper('box', { check: () => { throw failure; } });
    const agent = createAgent();
    agent.connect(box.component);
    expect(errorOf(await agent.act(press)).message).toBe('"press" on "box:1" failed inside its component.');
    expect(reported).toEqual([failure]);
  });
});

describe('act: allow', () => {
  it('runs an allow step without a callback and returns what the component reported', async () => {
    const box = stepper('box', { run: () => ({ status: 'done', result: { attempt: 2, tags: ['a'] }, gone: true }) });
    const agent = createAgent();
    agent.connect(box.component);
    const result = await agent.act(press);
    expect(result).toEqual({ ok: true, steps: [{ step: 0, ref: 'box:1', result: { attempt: 2, tags: ['a'] }, gone: true }] });
    expect(box.run.mock.calls[0]![1].approved).toBe('allow');
    // Frozen all the way down, and plain data.
    const step = result.steps[0]!;
    expect(Object.isFrozen(result.steps)).toBe(true);
    expect(Object.isFrozen(step)).toBe(true);
    expect(Object.isFrozen((step.result as { tags: unknown[] }).tags)).toBe(true);
    expect(structuredClone(result)).toEqual(result);
  });

  it('asks allow with the step and a signal, and runs on true', async () => {
    const box = stepper();
    const allow = vi.fn<Allow>(() => true);
    const agent = createAgent({ allow });
    agent.connect(box.component);
    const result = await agent.act({ steps: [{ ref: 'box', action: 'clear', args: [1] }] });
    expect(result.ok).toBe(true);
    const [step, context] = allow.mock.calls[0]!;
    expect(step).toEqual({ ref: 'box', action: 'clear', args: [1], needsPerson: false });
    expect(Object.isFrozen(step)).toBe(true);
    expect(context.signal.aborted).toBe(false);
  });

  it('says the app said no on false and does not summon anyone', async () => {
    const box = stepper();
    const agent = createAgent({ allow: () => false });
    agent.connect(box.component);
    const result = await agent.act({ steps: [{ ref: 'box', action: 'clear' }] });
    expect(errorOf(result).message).toBe('The app said no to "clear" on "box".');
    expect(box.run).not.toHaveBeenCalled();
    expect(box.summon).not.toHaveBeenCalled();
  });

  it('approves only on true', async () => {
    const box = stepper();
    const agent = createAgent({ allow: (() => 'yes') as unknown as Allow });
    agent.connect(box.component);
    expect(errorOf(await agent.act({ steps: [{ ref: 'box', action: 'clear' }] })).message).toBe('The app said no to "clear" on "box".');
    expect(box.run).not.toHaveBeenCalled();
  });

  it('treats an allow that throws or rejects as false and reports the error', async () => {
    const reported = captureReports();
    const thrown = new Error('allow threw');
    const rejected = new Error('allow rejected');
    const box = stepper('box', { check: confirm });
    let call = 0;
    const agent = createAgent({ allow: () => { call += 1; if (call === 1) throw thrown; return Promise.reject(rejected); } });
    agent.connect(box.component);
    expect(errorOf(await agent.act(press)).message).toMatch(/^Needs a person:/);
    expect(errorOf(await agent.act(press)).message).toMatch(/^Needs a person:/);
    expect(box.run).not.toHaveBeenCalled();
    expect(box.summon).toHaveBeenCalledTimes(2);
    expect(reported).toEqual([thrown, rejected]);
  });

  it('runs a confirm step only when allow approves it, telling the component what was cleared', async () => {
    const box = stepper('box', { check: confirm });
    const allow = vi.fn<Allow>(async () => true);
    const agent = createAgent({ allow });
    agent.connect(box.component);
    const result = await agent.act(press);
    expect(result.ok).toBe(true);
    expect(allow.mock.calls[0]![0].needsPerson).toBe(true);
    expect(box.run.mock.calls[0]![1].approved).toBe('confirm');
    expect(box.summon).not.toHaveBeenCalled();
  });

  it('needs a person for a confirm step without a callback, and summons them', async () => {
    const box = stepper('box', { check: confirm });
    const agent = createAgent();
    agent.connect(box.component);
    const result = await agent.act(press);
    expect(errorOf(result).message).toBe('Needs a person: "Undo" on "File deleted". It is on screen in front of them now. Ask them to press "Undo" themselves.');
    expect(box.summon).toHaveBeenCalledWith({ ref: 'box:1', action: 'press', args: [] });
    expect(box.run).not.toHaveBeenCalled();
  });

  it('needs a person when allow says false, and says so when nothing could be shown', async () => {
    const box = stepper('box', { check: confirm, summon: () => false });
    const agent = createAgent({ allow: () => false });
    agent.connect(box.component);
    const result = await agent.act(press);
    expect(errorOf(result).message).toBe('Needs a person: "Undo" on "File deleted". It is not on screen, so tell them what it does.');
    expect(box.summon).toHaveBeenCalledTimes(1);
  });

  it('needs a person even when the component cannot summon one', async () => {
    const { summon: _summon, ...withoutSummon } = stepper('box', { check: confirm }).component;
    void _summon;
    const agent = createAgent();
    agent.connect(withoutSummon);
    expect(errorOf(await agent.act(press)).message).toBe('Needs a person: "Undo" on "File deleted". It is not on screen, so tell them what it does.');
  });
});

describe('act: timeout', () => {
  it('needs a person when allow does not answer within five minutes, and a late true runs nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const box = stepper('box', { check: confirm });
    const answer = deferred<boolean>();
    const allow = vi.fn<Allow>(() => answer.promise);
    const agent = createAgent({ allow });
    agent.connect(box.component);
    let result: ActResult | undefined;
    void agent.act(press).then((value) => { result = value; });

    await vi.advanceTimersByTimeAsync(299_999);
    expect(result).toBeUndefined();
    const { signal } = allow.mock.calls[0]![1];
    expect(signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(errorOf(result!).message).toMatch(/^Needs a person: "Undo"/);
    expect(box.summon).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).name).toBe('TimeoutError');

    answer.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(box.run).not.toHaveBeenCalled();
  });

  it('refuses an allow step whose answer did not come in time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const box = stepper();
    const agent = createAgent({ allow: () => new Promise<boolean>(() => {}), timeout: 50 });
    agent.connect(box.component);
    const pending = agent.act({ steps: [{ ref: 'box', action: 'clear' }] });
    await vi.advanceTimersByTimeAsync(50);
    expect(errorOf(await pending).message).toBe('The app did not answer about "clear" on "box" in time, so it did not run.');
    expect(box.summon).not.toHaveBeenCalled();
    expect(box.run).not.toHaveBeenCalled();
  });

  it('counts a step still running at the timeout as done and pending, and goes on', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const work = deferred<AgentRunOutcome>();
    let call = 0;
    const box = stepper('box', { run: () => (call++ === 0 ? work.promise : { status: 'done' }) });
    const agent = createAgent({ timeout: 1_000 });
    agent.connect(box.component);
    const pending = agent.act({ steps: [{ ref: 'box:1', action: 'press' }, { ref: 'box', action: 'clear' }] });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toEqual({ ok: true, steps: [{ step: 0, ref: 'box:1', result: 'pending' }, { step: 1, ref: 'box' }] });
    expect(box.run.mock.calls[0]![1].signal.aborted).toBe(true);
    // A late outcome changes nothing.
    work.resolve({ status: 'failed', message: 'too late' });
    await vi.advanceTimersByTimeAsync(0);
  });

  it('starts no timer when allow and the component answer at once', async () => {
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const box = stepper();
    const agent = createAgent({ allow: () => true });
    agent.connect(box.component);
    expect((await agent.act(press)).ok).toBe(true);
    expect(timer).not.toHaveBeenCalled();
  });
});

describe('act: cancellation', () => {
  it('runs nothing for a signal that is already aborted', async () => {
    const box = stepper();
    const allow = vi.fn(() => true);
    const agent = createAgent({ allow });
    agent.connect(box.component);
    const controller = new AbortController();
    controller.abort();
    const result = await agent.act(press, { signal: controller.signal });
    expect(errorOf(result)).toEqual({ step: 0, message: 'Cancelled before "press" on "box:1" ran.' });
    expect(box.check).not.toHaveBeenCalled();
    expect(allow).not.toHaveBeenCalled();
  });

  it('stops waiting for allow, summons no one, and ignores a late true', async () => {
    const box = stepper('box', { check: confirm });
    const answer = deferred<boolean>();
    const allow = vi.fn<Allow>(() => answer.promise);
    const agent = createAgent({ allow });
    agent.connect(box.component);
    const controller = new AbortController();
    const pending = agent.act(press, { signal: controller.signal });
    await settle();
    const reason = new Error('user left');
    controller.abort(reason);
    expect(errorOf(await pending).message).toBe('Cancelled before "press" on "box:1" ran.');
    expect(allow.mock.calls[0]![1].signal.aborted).toBe(true);
    expect(allow.mock.calls[0]![1].signal.reason).toBe(reason);
    answer.resolve(true);
    await settle();
    expect(box.run).not.toHaveBeenCalled();
    expect(box.summon).not.toHaveBeenCalled();
  });

  it('does not run a step when the signal aborts inside a synchronous allow', async () => {
    const box = stepper();
    const controller = new AbortController();
    const agent = createAgent({ allow: () => { controller.abort(); return true; } });
    agent.connect(box.component);
    expect(errorOf(await agent.act(press, { signal: controller.signal })).message).toBe('Cancelled before "press" on "box:1" ran.');
    expect(box.run).not.toHaveBeenCalled();
  });

  it('stops waiting for the component and says the step may still finish', async () => {
    const box = stepper('box', { run: () => new Promise<AgentRunOutcome>(() => {}) });
    const agent = createAgent();
    agent.connect(box.component);
    const controller = new AbortController();
    const pending = agent.act(press, { signal: controller.signal });
    await settle();
    controller.abort();
    expect(errorOf(await pending).message).toBe('Cancelled while "press" on "box:1" was running. It may still finish.');
    expect(box.run.mock.calls[0]![1].signal.aborted).toBe(true);
  });

  it('answers a call cancelled while it waits for its turn, and never runs it', async () => {
    const answer = deferred<boolean>();
    const box = stepper();
    const agent = createAgent({ allow: () => answer.promise });
    agent.connect(box.component);
    const first = agent.act({ steps: [{ ref: 'box', action: 'clear' }] });
    const controller = new AbortController();
    const second = agent.act(press, { signal: controller.signal });
    await settle();
    controller.abort();
    expect(errorOf(await second).message).toBe('Cancelled before "press" on "box:1" ran.');
    answer.resolve(true);
    expect((await first).ok).toBe(true);
    await settle();
    expect(box.check.mock.calls.map(([step]) => step.ref)).toEqual(['box']);
  });
});

describe('act: order and errors', () => {
  it('stops at the first error and says which steps stayed done', async () => {
    const box = stepper('box', { run: (step) => (step.ref === 'box:1' ? { status: 'failed', message: '"Undo" failed: The file is gone.' } : { status: 'done' }) });
    const agent = createAgent();
    agent.connect(box.component);
    const one = await agent.act({ steps: [{ ref: 'box', action: 'clear' }, { ref: 'box:1', action: 'press' }, { ref: 'box', action: 'clear' }] });
    expect(one).toEqual({ ok: false, error: { step: 1, message: '"Undo" failed: The file is gone. Step 0 stayed done.' }, steps: [{ step: 0, ref: 'box' }] });
    expect(box.run).toHaveBeenCalledTimes(2);

    const two = await agent.act({ steps: [{ ref: 'box', action: 'clear' }, { ref: 'box', action: 'clear' }, { ref: 'box:1', action: 'press' }] });
    expect(errorOf(two).message).toBe('"Undo" failed: The file is gone. Steps 0–1 stayed done.');
    expect(two.steps.map((step) => step.step)).toEqual([0, 1]);
  });

  it('runs calls one at a time: a call made from allow waits for the first to finish', async () => {
    const order: string[] = [];
    const box = stepper('box', { run: (step) => { order.push(`run ${step.ref}`); return { status: 'done' }; } });
    let agent!: ReturnType<typeof createAgent>;
    let inner: Promise<ActResult> | undefined;
    agent = createAgent({
      allow: async (step) => {
        order.push(`allow ${step.ref}`);
        if (!inner) inner = agent.act({ steps: [{ ref: 'box', action: 'clear' }] });
        await settle();
        return true;
      },
    });
    agent.connect(box.component);
    const outer = await agent.act(press);
    expect(outer.ok).toBe(true);
    expect((await inner!).ok).toBe(true);
    expect(order).toEqual(['allow box:1', 'run box:1', 'allow box', 'run box']);
  });

  it('keeps later calls waiting while a step waits, then runs them in order', async () => {
    const answers = [deferred<boolean>(), deferred<boolean>()];
    let call = 0;
    const box = stepper();
    const agent = createAgent({ allow: () => answers[call++]!.promise });
    agent.connect(box.component);
    const first = agent.act({ steps: [{ ref: 'box', action: 'clear' }] });
    const second = agent.act(press);
    await settle();
    expect(call).toBe(1);
    answers[0]!.resolve(true);
    await first;
    await settle();
    expect(call).toBe(2);
    answers[1]!.resolve(true);
    expect((await second).ok).toBe(true);
  });

  it('refuses a step whose component was disconnected while it waited', async () => {
    const box = stepper('box', { check: confirm });
    const answer = deferred<boolean>();
    const agent = createAgent({ allow: () => answer.promise });
    const disconnect = agent.connect(box.component);
    agent.connect(stepper('other', { entries: [{ ref: 'other', component: 'other', actions: [] }] }).component);
    const pending = agent.act(press);
    await settle();
    disconnect();
    answer.resolve(true);
    expect(errorOf(await pending).message).toBe('No entry "box:1". Current refs: other.');
    expect(box.run).not.toHaveBeenCalled();
    expect(box.summon).not.toHaveBeenCalled();
  });

  it('passes on what run says when the step changed while it waited', async () => {
    const box = stepper('box', { run: () => ({ status: 'stale' }) });
    const agent = createAgent();
    agent.connect(box.component);
    expect(errorOf(await agent.act(press)).message).toBe('"press" on "box:1" changed while it waited, so it did not run. Read the snapshot and try again.');
  });

  it('lists the fresh verbs when run finds the step no longer available', async () => {
    const box = stepper('box', { run: () => { box.set([{ ref: 'box:1', component: 'item', actions: ['dismiss'] }]); return { status: 'unavailable' }; } });
    const agent = createAgent();
    agent.connect(box.component);
    expect(errorOf(await agent.act(press)).message).toBe('"press" is not available on "box:1" now. Available: dismiss.');
  });

  it("passes run's own unavailable message through", async () => {
    const box = stepper('box', { run: () => ({ status: 'unavailable', message: '"Undo" is already running.' }) });
    const agent = createAgent();
    agent.connect(box.component);
    expect(errorOf(await agent.act(press)).message).toBe('"Undo" is already running.');
  });

  it('reports a run that throws, rejects or answers nonsense, and never rejects itself', async () => {
    const reported = captureReports();
    const thrown = new Error('run threw');
    const rejected = new Error('run rejected');
    const answers: Array<() => AgentRunOutcome | PromiseLike<AgentRunOutcome>> = [
      () => { throw thrown; },
      () => Promise.reject(rejected),
      () => ({ status: 'maybe' }) as never,
      () => null as never,
    ];
    let call = 0;
    const box = stepper('box', { run: () => answers[call++]!() });
    const agent = createAgent();
    agent.connect(box.component);
    for (let index = 0; index < answers.length; index++) {
      expect(errorOf(await agent.act(press)).message).toBe('"press" on "box:1" failed inside its component.');
    }
    expect(reported.slice(0, 2)).toEqual([thrown, rejected]);
    expect(reported).toHaveLength(4);
  });

  it('drops a result that is not plain data but keeps the step done', async () => {
    const reported = captureReports();
    const box = stepper('box', { run: () => ({ status: 'done', result: { at: new Date(0) } as never }) });
    const agent = createAgent();
    agent.connect(box.component);
    expect(await agent.act(press)).toEqual({ ok: true, steps: [{ step: 0, ref: 'box:1' }] });
    expect(reported).toHaveLength(1);
  });

  it('settles even when a component breaks while the bridge looks for the record', async () => {
    const reported = captureReports();
    const box = stepper();
    let broken = false;
    const agent = createAgent();
    agent.connect({ ...box.component, snapshot: () => { if (broken) throw new Error('snapshot broke'); return []; } });
    broken = true;
    const result = await agent.act(press);
    expect(errorOf(result).message).toBe('The agent bridge failed. No further step ran.');
    expect(reported).toHaveLength(1);
    broken = false;
    expect(errorOf(await agent.act(press)).message).toBe('No entry "box:1". Current refs: none.');
  });
});
