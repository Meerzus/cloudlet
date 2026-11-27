import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAgent, type ActResult, type AgentComponent, type AgentEntry, type AgentRunContext, type AgentRunOutcome, type AgentStepCall,
  type AgentStepCheck, type AgentSummonOutcome, type Allow, type AllowStep,
} from '@cloudlet/agent';

type Check = (step: AgentStepCall) => AgentStepCheck;

/** A component with one record that takes `press`; `check` decides the permission. */
function box(check: Check = () => ({ available: true, permission: 'allow' })) {
  const records: readonly AgentEntry[] = [{ ref: 'box:1', component: 'item', actions: ['press'] }];
  const run = vi.fn<(step: AgentStepCall, context: AgentRunContext) => AgentRunOutcome>(() => ({ status: 'done' }));
  const summon = vi.fn<(step: AgentStepCall) => AgentSummonOutcome>(() => true);
  const component: AgentComponent = {
    protocol: 1,
    name: 'box',
    snapshot: () => records,
    subscribe: () => () => {},
    check: vi.fn(check),
    run,
    summon,
  };
  return { component, run, summon };
}

const allowClass: Check = () => ({ available: true, permission: 'allow' });
const confirm: Check = () => ({ available: true, permission: 'confirm', names: { target: 'Undo', within: 'File deleted' } });
const deny: Check = () => ({ available: true, permission: 'deny' });
const press = { steps: [{ ref: 'box:1', action: 'press' }] };

const SAID_NO = 'The app said no to "press" on "box:1".';
const NO_ANSWER = 'The app did not answer about "press" on "box:1" in time, so it did not run.';
const NEEDS_PERSON = 'Needs a person: "Undo" on "File deleted". It is on screen in front of them now. Ask them to press "Undo" themselves.';
const CANCELLED = 'Cancelled before "press" on "box:1" ran.';

function errorOf(result: ActResult): string {
  if (result.ok) throw new Error('Expected a failed call');
  return result.error.message;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const settle = async (): Promise<void> => { for (let index = 0; index < 10; index++) await Promise.resolve(); };

/** A gate that remembers the questions it was asked and the order of every gate's turn. */
function gate(answer: boolean | ((step: AllowStep) => boolean | PromiseLike<boolean>), order?: string[], label?: string) {
  return vi.fn<Allow>((step) => {
    if (order && label) order.push(label);
    return typeof answer === 'function' ? answer(step) : answer;
  });
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('the call’s own allow: a second gate', () => {
  it('runs a step both gates approve, asking the agent’s gate first and the call’s with the same question', async () => {
    const order: string[] = [];
    const first = gate(true, order, 'agent');
    const second = gate(true, order, 'call');
    const target = box(allowClass);
    const agent = createAgent({ allow: first });
    agent.connect(target.component);
    const result = await agent.act({ steps: [{ ref: 'box:1', action: 'press', args: [1] }] }, { allow: second });
    expect(result.ok).toBe(true);
    expect(order).toEqual(['agent', 'call']);
    expect(target.run).toHaveBeenCalledTimes(1);
    const asked = { ref: 'box:1', action: 'press', args: [1], needsPerson: false };
    expect(first.mock.calls[0]![0]).toEqual(asked);
    expect(second.mock.calls[0]![0]).toEqual(asked);
    expect(Object.isFrozen(second.mock.calls[0]![0])).toBe(true);
    expect(second.mock.calls[0]![1].signal.aborted).toBe(false);
  });

  it('never asks the call’s gate about a step the agent’s gate refused', async () => {
    const second = gate(true);
    const target = box(allowClass);
    const agent = createAgent({ allow: () => false });
    agent.connect(target.component);
    expect(errorOf(await agent.act(press, { allow: second }))).toBe(SAID_NO);
    expect(second).not.toHaveBeenCalled();
    expect(target.run).not.toHaveBeenCalled();
  });

  it('refuses a step the call’s gate refuses, though the agent’s gate approved it', async () => {
    const target = box(allowClass);
    const agent = createAgent({ allow: () => true });
    agent.connect(target.component);
    expect(errorOf(await agent.act(press, { allow: () => false }))).toBe(SAID_NO);
    expect(target.run).not.toHaveBeenCalled();
    expect(target.summon).not.toHaveBeenCalled();
  });

  it('treats any answer but true from the call’s gate as a refusal', async () => {
    const target = box(allowClass);
    const agent = createAgent({ allow: () => true });
    agent.connect(target.component);
    expect(errorOf(await agent.act(press, { allow: (() => 'yes') as never }))).toBe(SAID_NO);
    expect(target.run).not.toHaveBeenCalled();
  });

  it('asks only the call’s gate about an allow-class step on an agent without allow', async () => {
    const target = box(allowClass);
    const agent = createAgent();
    agent.connect(target.component);
    const second = gate(false);
    expect(errorOf(await agent.act(press, { allow: second }))).toBe(SAID_NO);
    expect(second.mock.calls[0]![0].needsPerson).toBe(false);
    expect(target.run).not.toHaveBeenCalled();
    expect((await agent.act(press, { allow: () => true })).ok).toBe(true);
    expect(target.run).toHaveBeenCalledTimes(1);
  });

  it('runs a step that needs a person when both gates answer for the person', async () => {
    const target = box(confirm);
    const agent = createAgent({ allow: () => true });
    agent.connect(target.component);
    const second = gate(true);
    expect((await agent.act(press, { allow: second })).ok).toBe(true);
    expect(second.mock.calls[0]![0].needsPerson).toBe(true);
    expect(target.run.mock.calls[0]![1]).toMatchObject({ approved: 'confirm' });
  });

  it('hands a step that needs a person to the person when the call’s gate refuses it', async () => {
    const target = box(confirm);
    const agent = createAgent({ allow: () => true });
    agent.connect(target.component);
    expect(errorOf(await agent.act(press, { allow: () => false }))).toBe(NEEDS_PERSON);
    expect(target.summon).toHaveBeenCalledTimes(1);
    expect(target.run).not.toHaveBeenCalled();
  });

  it('never widens: without the agent’s allow, a step that needs a person goes to the person and the call’s gate is not asked', async () => {
    const target = box(confirm);
    const agent = createAgent();
    agent.connect(target.component);
    const second = gate(true);
    expect(errorOf(await agent.act(press, { allow: second }))).toBe(NEEDS_PERSON);
    expect(second).not.toHaveBeenCalled();
    expect(target.run).not.toHaveBeenCalled();
    expect(target.summon).toHaveBeenCalledTimes(1);
  });

  it('asks neither gate about a step the component denies', async () => {
    const first = gate(true);
    const second = gate(true);
    const target = box(deny);
    const agent = createAgent({ allow: first });
    agent.connect(target.component);
    expect(errorOf(await agent.act(press, { allow: second }))).toMatch(/^Not allowed: /);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it('gives each gate the whole timeout, and a call’s gate that does not answer refuses', async () => {
    vi.useFakeTimers();
    const target = box(allowClass);
    const agent = createAgent({ timeout: 1_000, allow: () => new Promise<boolean>((resolve) => { setTimeout(() => { resolve(true); }, 900); }) });
    agent.connect(target.component);
    const slow = agent.act(press, { allow: () => new Promise<boolean>((resolve) => { setTimeout(() => { resolve(true); }, 900); }) });
    await vi.advanceTimersByTimeAsync(1_800);
    expect((await slow).ok).toBe(true);

    let withdrawn: boolean | undefined;
    const silent = agent.act(press, { allow: (_step, { signal }) => {
      signal.addEventListener('abort', () => { withdrawn = true; });
      return new Promise<boolean>(() => {});
    } });
    await vi.advanceTimersByTimeAsync(900 + 1_000);
    expect(errorOf(await silent)).toBe(NO_ANSWER);
    expect(withdrawn).toBe(true);
    expect(target.run).toHaveBeenCalledTimes(1);
  });

  it('summons the person when the call’s gate does not answer a step that needs one', async () => {
    vi.useFakeTimers();
    const target = box(confirm);
    const agent = createAgent({ timeout: 1_000, allow: () => true });
    agent.connect(target.component);
    const call = agent.act(press, { allow: () => new Promise<boolean>(() => {}) });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(errorOf(await call)).toBe(NEEDS_PERSON);
    expect(target.summon).toHaveBeenCalledTimes(1);
  });

  it('withdraws the call’s question when the call is cancelled, and ignores a late true', async () => {
    const target = box(allowClass);
    const agent = createAgent({ allow: () => true });
    agent.connect(target.component);
    const answer = deferred<boolean>();
    let gateSignal: AbortSignal | undefined;
    const controller = new AbortController();
    const call = agent.act(press, { signal: controller.signal, allow: (_step, { signal }) => { gateSignal = signal as AbortSignal; return answer.promise; } });
    await settle();
    controller.abort();
    expect(errorOf(await call)).toBe(CANCELLED);
    expect(gateSignal?.aborted).toBe(true);
    answer.resolve(true);
    await settle();
    expect(target.run).not.toHaveBeenCalled();
    expect(target.summon).not.toHaveBeenCalled();
  });

  it('fails with the current refs when the component left while the call’s gate decided', async () => {
    const target = box(allowClass);
    const agent = createAgent({ allow: () => true });
    const disconnect = agent.connect(target.component);
    const answer = deferred<boolean>();
    const call = agent.act(press, { allow: () => answer.promise });
    await settle();
    disconnect();
    answer.resolve(true);
    expect(errorOf(await call)).toBe('No entry "box:1". Current refs: none.');
    expect(target.run).not.toHaveBeenCalled();
  });

  it('reports what the call’s gate threw and refuses the step', async () => {
    const reported: unknown[] = [];
    vi.stubGlobal('console', { ...console, error: (error: unknown) => { reported.push(error); } });
    const target = box(allowClass);
    const agent = createAgent({ allow: () => true });
    agent.connect(target.component);
    const thrown = new Error('gate broke');
    expect(errorOf(await agent.act(press, { allow: () => { throw thrown; } }))).toBe(SAID_NO);
    expect(reported).toEqual([thrown]);
  });

  it('refuses an allow that is not a function before any step', async () => {
    const target = box(allowClass);
    const agent = createAgent();
    agent.connect(target.component);
    const result = await agent.act(press, { allow: true as never });
    expect(result).toEqual({ ok: false, error: { step: 0, message: 'Invalid call: options.allow must be a function. No step ran.' }, steps: [] });
    expect(target.run).not.toHaveBeenCalled();
  });

  it('applies to cloudlet_act through callTool, and the gate is asked once per step', async () => {
    const target = box(allowClass);
    const agent = createAgent({ allow: () => true });
    agent.connect(target.component);
    const second = gate((step) => step.args[0] !== 'no');
    const result = await agent.callTool('cloudlet_act', {
      steps: [{ ref: 'box:1', action: 'press', args: ['yes'] }, { ref: 'box:1', action: 'press', args: ['no'] }],
    }, { allow: second });
    expect(result).toMatchObject({ ok: false, error: { step: 1, message: `${SAID_NO} Step 0 stayed done.` }, steps: [{ step: 0, ref: 'box:1' }] });
    expect(second).toHaveBeenCalledTimes(2);
    expect(target.run).toHaveBeenCalledTimes(1);
  });

  it('is the call’s own: the next call without it is not narrowed', async () => {
    const target = box(allowClass);
    const agent = createAgent();
    agent.connect(target.component);
    expect((await agent.act(press, { allow: () => false })).ok).toBe(false);
    expect((await agent.act(press)).ok).toBe(true);
  });
});
