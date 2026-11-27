import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgent, registerTools, type Agent, type AgentComponent, type AgentRunOutcome, type Allow } from '@cloudlet/agent';

interface Registered {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: object;
  readonly annotations: object;
  readonly execute: (input: unknown, options?: { signal?: unknown }) => Promise<unknown>;
}

/**
 * A stand-in for `document.modelContext` as the WebMCP draft describes it: a name taken twice
 * rejects with `InvalidStateError`, an aborted signal rejects with its reason, and aborting the
 * signal after registration removes the tool.
 */
function fakeContext() {
  const tools = new Map<string, Registered>();
  const registerTool = vi.fn((tool: Registered, options: { signal: AbortSignal }): unknown => {
    const { signal } = options;
    if (signal.aborted) return Promise.reject(signal.reason);
    if (tools.has(tool.name)) return Promise.reject(new DOMException('Duplicate tool name', 'InvalidStateError'));
    tools.set(tool.name, tool);
    signal.addEventListener('abort', () => { if (tools.get(tool.name) === tool) tools.delete(tool.name); }, { once: true });
    return Promise.resolve(undefined);
  });
  return { tools, registerTool };
}

/** A component with one record that takes `press` without anyone's say. */
function box(run: () => AgentRunOutcome | PromiseLike<AgentRunOutcome> = () => ({ status: 'done' })): AgentComponent & { run: ReturnType<typeof vi.fn> } {
  return {
    protocol: 1,
    name: 'box',
    snapshot: () => [{ ref: 'box:1', component: 'item', actions: ['press'], label: 'Box' }],
    subscribe: () => () => {},
    check: () => ({ available: true, permission: 'allow' }),
    run: vi.fn(run),
  };
}

const settle = async (): Promise<void> => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
const press = { steps: [{ ref: 'box:1', action: 'press' }] };
const yes: Allow = () => true;

/** Every console method, so a test can say nothing was written. */
function watchConsole() {
  const calls: unknown[][] = [];
  const quiet = (...data: unknown[]) => { calls.push(data); };
  vi.stubGlobal('console', { ...console, log: quiet, info: quiet, warn: quiet, error: quiet, debug: quiet });
  return calls;
}

function withContext(context: unknown = fakeContext()) {
  vi.stubGlobal('document', { modelContext: context });
  return context;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('registerTools without WebMCP', () => {
  it('does nothing and says nothing where there is no document', () => {
    const calls = watchConsole();
    const unregister = registerTools(createAgent(), { allow: yes });
    expect(unregister).toBeTypeOf('function');
    unregister();
    unregister();
    expect(calls).toEqual([]);
  });

  it('does nothing where the document has no modelContext, or one without registerTool', () => {
    const calls = watchConsole();
    for (const document of [{}, { modelContext: null }, { modelContext: {} }, { modelContext: { registerTool: 'no' } }]) {
      vi.stubGlobal('document', document);
      const onError = vi.fn();
      expect(() => { registerTools(createAgent(), { allow: yes, onError })(); }).not.toThrow();
      expect(onError).not.toHaveBeenCalled();
    }
    expect(calls).toEqual([]);
  });

  it('throws a TypeError for a missing allow, a bad onError or something that is not an agent, with WebMCP or without', () => {
    for (const context of [undefined, fakeContext()]) {
      if (context) withContext(context);
      expect(() => registerTools(createAgent(), {} as never)).toThrow(TypeError);
      expect(() => registerTools(createAgent(), undefined as never)).toThrow(TypeError);
      expect(() => registerTools(createAgent(), { allow: true } as never)).toThrow(/allow/);
      expect(() => registerTools(createAgent(), { allow: yes, onError: 'log' } as never)).toThrow(TypeError);
      expect(() => registerTools({} as Agent, { allow: yes })).toThrow(TypeError);
      expect(() => registerTools({ callTool: () => {}, tools: 'x' } as never, { allow: yes })).toThrow(TypeError);
      if (context) expect(context.registerTool).not.toHaveBeenCalled();
    }
  });
});

describe('registerTools with WebMCP', () => {
  it('registers both tools with their texts, schemas and annotations, under one signal', () => {
    const context = withContext() as ReturnType<typeof fakeContext>;
    const agent = createAgent();
    registerTools(agent, { allow: yes });
    expect(context.registerTool).toHaveBeenCalledTimes(2);
    const [act, snapshot] = agent.tools;
    expect(context.tools.get('cloudlet_act')).toMatchObject({
      name: 'cloudlet_act', description: act!.description, inputSchema: act!.inputSchema,
      annotations: { consequentialHint: true, untrustedContentHint: true },
    });
    expect(context.tools.get('cloudlet_snapshot')).toMatchObject({
      name: 'cloudlet_snapshot', description: snapshot!.description, inputSchema: snapshot!.inputSchema,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
    });
    for (const [tool] of context.registerTool.mock.calls) expect(Object.keys(tool).sort()).toEqual(['annotations', 'description', 'execute', 'inputSchema', 'name']);
    expect(Object.keys(context.tools.get('cloudlet_act')!.annotations).sort()).toEqual(['consequentialHint', 'untrustedContentHint']);
    const [first, second] = context.registerTool.mock.calls.map(([, options]) => options.signal);
    expect(first).toBe(second);
    expect(first!.aborted).toBe(false);
  });

  it('answers a valid and an invalid input with plain data, and never throws', async () => {
    const context = withContext() as ReturnType<typeof fakeContext>;
    const agent = createAgent();
    const component = box();
    agent.connect(component);
    registerTools(agent, { allow: yes });
    const { execute: snapshot } = context.tools.get('cloudlet_snapshot')!;
    const { execute: act } = context.tools.get('cloudlet_act')!;
    const signal = new AbortController().signal;

    const read = await snapshot({}, { signal });
    expect(read).toMatchObject({ entries: [{ ref: 'box:1', label: 'Box' }] });
    expect(JSON.parse(JSON.stringify(read))).toEqual(read);
    expect(await snapshot({ ref: 'box:1' }, { signal })).toMatchObject({ ok: false, error: { message: expect.stringMatching(/^cloudlet_snapshot takes no input/) } });

    expect(await act(press, { signal })).toEqual({ ok: true, steps: [{ step: 0, ref: 'box:1' }], changes: [] });
    expect(component.run).toHaveBeenCalledTimes(1);
    const invalid = await act({ ref: 'box:1', action: 'press' }, { signal });
    expect(invalid).toMatchObject({ ok: false, error: { step: 0, message: expect.stringMatching(/^Invalid call: a step came on its own/) } });
    expect(await act('steps', { signal })).toMatchObject({ ok: false });
  });

  it('runs a call from a build that passes no signal, or one that is not a signal', async () => {
    const context = withContext() as ReturnType<typeof fakeContext>;
    const agent = createAgent();
    agent.connect(box());
    registerTools(agent, { allow: yes });
    const { execute } = context.tools.get('cloudlet_act')!;
    expect(await execute(press)).toMatchObject({ ok: true });
    expect(await execute(press, { signal: {} })).toMatchObject({ ok: true });
  });

  it('answers with text when the agent itself throws, and reports it', async () => {
    const context = withContext() as ReturnType<typeof fakeContext>;
    const thrown = new Error('broken agent');
    const agent = { ...createAgent(), callTool: () => { throw thrown; } } as unknown as Agent;
    const onError = vi.fn();
    registerTools(agent, { allow: yes, onError });
    await expect(context.tools.get('cloudlet_act')!.execute(press, { signal: new AbortController().signal }))
      .resolves.toEqual({ ok: false, error: { message: 'The agent bridge failed. Nothing ran.' } });
    expect(onError).toHaveBeenCalledWith(thrown);
  });
});

describe('the browser agent’s gate', () => {
  async function setup(agentAllow: Allow | undefined, allow: Allow, permission: 'allow' | 'confirm' = 'allow') {
    const context = withContext() as ReturnType<typeof fakeContext>;
    const agent = createAgent(agentAllow ? { allow: agentAllow } : {});
    const component = { ...box(), check: () => ({ available: true as const, permission }), summon: vi.fn(() => true) };
    agent.connect(component);
    registerTools(agent, { allow });
    const result = await context.tools.get('cloudlet_act')!.execute(press, { signal: new AbortController().signal });
    return { result, component };
  }

  it('runs a step when both gates say true', async () => {
    const allow = vi.fn<Allow>(() => true);
    const { result, component } = await setup(() => true, allow);
    expect(result).toMatchObject({ ok: true });
    expect(allow.mock.calls[0]![0]).toEqual({ ref: 'box:1', action: 'press', args: [], needsPerson: false });
    expect(component.run).toHaveBeenCalledTimes(1);
  });

  it('does not run a step the agent’s gate refuses, and does not ask the browser’s', async () => {
    const allow = vi.fn<Allow>(() => true);
    const { result, component } = await setup(() => false, allow);
    expect(result).toMatchObject({ ok: false, error: { message: 'The app said no to "press" on "box:1".' } });
    expect(allow).not.toHaveBeenCalled();
    expect(component.run).not.toHaveBeenCalled();
  });

  it('does not run a step the browser’s gate refuses', async () => {
    const { result, component } = await setup(() => true, () => false);
    expect(result).toMatchObject({ ok: false, error: { message: 'The app said no to "press" on "box:1".' } });
    expect(component.run).not.toHaveBeenCalled();
  });

  it('asks the browser’s gate about a step that needs a person with needsPerson, and its true answers for the person with the agent’s', async () => {
    const allow = vi.fn<Allow>(() => true);
    const { result, component } = await setup(() => true, allow, 'confirm');
    expect(result).toMatchObject({ ok: true });
    expect(allow.mock.calls[0]![0].needsPerson).toBe(true);
    expect(component.run).toHaveBeenCalledTimes(1);
  });

  it('cannot approve a step that needs a person on an agent without allow: it goes to the person', async () => {
    const allow = vi.fn<Allow>(() => true);
    const { result, component } = await setup(undefined, allow, 'confirm');
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringMatching(/^Needs a person: /) } });
    expect(allow).not.toHaveBeenCalled();
    expect(component.summon).toHaveBeenCalledTimes(1);
    expect(component.run).not.toHaveBeenCalled();
  });

  it('stops waiting for the browser’s gate when the browser cancels the call', async () => {
    const context = withContext() as ReturnType<typeof fakeContext>;
    const agent = createAgent();
    const component = box();
    agent.connect(component);
    let asked: AbortSignal | undefined;
    registerTools(agent, { allow: (_step, { signal }) => { asked = signal as AbortSignal; return new Promise<boolean>(() => {}); } });
    const controller = new AbortController();
    const call = context.tools.get('cloudlet_act')!.execute(press, { signal: controller.signal });
    await settle();
    controller.abort();
    expect(await call).toMatchObject({ ok: false, error: { message: 'Cancelled before "press" on "box:1" ran.' } });
    expect(asked?.aborted).toBe(true);
    expect(component.run).not.toHaveBeenCalled();
  });
});

describe('registration errors and removal', () => {
  it('sends a duplicate name to onError, once per tool, and keeps the first registration', async () => {
    const context = withContext() as ReturnType<typeof fakeContext>;
    const agent = createAgent();
    registerTools(agent, { allow: yes });
    const onError = vi.fn();
    registerTools(agent, { allow: yes, onError });
    await settle();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls.map(([error]) => (error as DOMException).name)).toEqual(['InvalidStateError', 'InvalidStateError']);
    expect(context.tools.size).toBe(2);
  });

  it('sends NotAllowedError to reportError without onError, and says nothing when there is neither', async () => {
    const denied = new DOMException('tools is not allowed in this frame', 'NotAllowedError');
    withContext({ registerTool: () => Promise.reject(denied) });
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    registerTools(createAgent(), { allow: yes });
    await settle();
    expect(reportError.mock.calls).toEqual([[denied], [denied]]);

    vi.stubGlobal('reportError', undefined);
    const calls = watchConsole();
    expect(() => { registerTools(createAgent(), { allow: yes }); }).not.toThrow();
    await settle();
    expect(calls).toEqual([]);
  });

  it('works with a build whose registerTool returns no promise, and catches one that throws', async () => {
    const tools: string[] = [];
    withContext({ registerTool: (tool: Registered) => { tools.push(tool.name); } });
    const onError = vi.fn();
    registerTools(createAgent(), { allow: yes, onError });
    await settle();
    expect(tools).toEqual(['cloudlet_act', 'cloudlet_snapshot']);
    expect(onError).not.toHaveBeenCalled();

    const thrown = new TypeError('registerTool is not ready');
    const tried: string[] = [];
    withContext({ registerTool: (tool: Registered) => { tried.push(tool.name); throw thrown; } });
    expect(() => { registerTools(createAgent(), { allow: yes, onError }); }).not.toThrow();
    expect(tried).toEqual(['cloudlet_act', 'cloudlet_snapshot']);
    expect(onError.mock.calls).toEqual([[thrown], [thrown]]);
  });

  it('catches a promise-like whose then throws', async () => {
    const thrown = new Error('then broke');
    withContext({ registerTool: () => ({ get then() { throw thrown; } }) });
    const onError = vi.fn();
    registerTools(createAgent(), { allow: yes, onError });
    await settle();
    expect(onError.mock.calls).toEqual([[thrown], [thrown]]);
  });

  it('ignores a registration withdrawn with AbortError', async () => {
    withContext({ registerTool: () => Promise.reject(new DOMException('The operation was aborted.', 'AbortError')) });
    const onError = vi.fn();
    registerTools(createAgent(), { allow: yes, onError });
    await settle();
    expect(onError).not.toHaveBeenCalled();
  });

  it('surfaces an onError that throws through reportError and never throws itself', async () => {
    withContext({ registerTool: () => { throw new Error('no'); } });
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    const broken = new Error('handler broke');
    expect(() => { registerTools(createAgent(), { allow: yes, onError: () => { throw broken; } }); }).not.toThrow();
    expect(reportError.mock.calls).toEqual([[broken], [broken]]);
  });

  it('removes both tools by aborting their signal, once, and registers again after removal', async () => {
    const context = withContext() as ReturnType<typeof fakeContext>;
    const agent = createAgent();
    const onError = vi.fn();
    const unregister = registerTools(agent, { allow: yes, onError });
    const { signal } = context.registerTool.mock.calls[0]![1];
    const aborts = vi.fn();
    signal.addEventListener('abort', aborts);
    unregister();
    unregister();
    expect(signal.aborted).toBe(true);
    expect(aborts).toHaveBeenCalledTimes(1);
    expect(context.tools.size).toBe(0);

    registerTools(agent, { allow: yes, onError });
    await settle();
    expect([...context.tools.keys()]).toEqual(['cloudlet_act', 'cloudlet_snapshot']);
    expect(onError).not.toHaveBeenCalled();
  });

  it('leaves no duplicate after mount, unmount and mount again, as StrictMode runs an effect', async () => {
    const context = withContext() as ReturnType<typeof fakeContext>;
    const agent = createAgent();
    const onError = vi.fn();
    const effect = () => registerTools(agent, { allow: yes, onError });
    const cleanup = effect();
    cleanup();
    const second = effect();
    await settle();
    expect(context.tools.size).toBe(2);
    expect(context.registerTool).toHaveBeenCalledTimes(4);
    expect(onError).not.toHaveBeenCalled();
    second();
    expect(context.tools.size).toBe(0);
  });

  it('ignores the AbortError of a registration removed before the browser answered', async () => {
    const pending: { reject: (error: unknown) => void; signal: AbortSignal }[] = [];
    withContext({ registerTool: (_tool: Registered, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      pending.push({ reject, signal });
      signal.addEventListener('abort', () => { reject(signal.reason); });
    }) });
    const onError = vi.fn();
    registerTools(createAgent(), { allow: yes, onError })();
    await settle();
    expect(pending).toHaveLength(2);
    expect(onError).not.toHaveBeenCalled();
  });
});
