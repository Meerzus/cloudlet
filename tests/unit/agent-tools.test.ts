import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAgent, type AgentActToolResult, type AgentChange, type AgentComponent, type AgentEntry, type AgentRunOutcome,
  type AgentToolResult, type Allow,
} from '@cloudlet/agent';
import { MOST_STEPS } from '../../packages/agent/src/tools.js';

const SHAPE = '{"steps": [{"ref": "<ref>", "action": "<verb>"}]}';
const ARGS = 'arguments go in "args" as a list, like "args": ["<first>", "<second>"]';

/** A component with one record, whose steps run `run` and which reports what `emit` is given. */
function box(spec: { run?: () => AgentRunOutcome | PromiseLike<AgentRunOutcome>; entries?: AgentEntry[] } = {}) {
  const listeners = new Set<(changes?: readonly AgentChange[]) => void>();
  const run = vi.fn(spec.run ?? (() => ({ status: 'done' as const })));
  const component: AgentComponent = {
    protocol: 1,
    name: 'box',
    snapshot: () => spec.entries ?? [{ ref: 'box', component: 'box', actions: ['press'], label: 'Box' }],
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    check: () => ({ available: true, permission: 'allow' }),
    run,
    verbs: { box: { press: 'Presses the box. No arguments.' } },
  };
  return {
    component, run,
    emit(...changes: AgentChange[]) { for (const listener of [...listeners]) listener(changes); },
  };
}

const change = (value: string, source: AgentChange['source'] = 'user'): AgentChange =>
  ({ ref: 'box', component: 'box', key: 'note', value, previous: null, source });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const settle = async (): Promise<void> => { for (let index = 0; index < 10; index++) await Promise.resolve(); };

/** What JSON keeps is what `structuredClone` keeps, and nothing is lost on the way. */
function expectPlain(value: AgentToolResult): void {
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  expect(structuredClone(value)).toEqual(value);
}

function captureReports(): unknown[] {
  const reported: unknown[] = [];
  vi.stubGlobal('console', { ...console, error: (error: unknown) => { reported.push(error); } });
  return reported;
}

afterEach(() => { vi.unstubAllGlobals(); });

const KEYWORDS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'description']);
const TYPES = new Set(['object', 'array', 'string']);

/** Walks a schema and fails on a keyword or type the bridge does not mean to use. */
function expectSchema(schema: unknown, at = 'schema'): void {
  expect(schema, at).toBeTypeOf('object');
  const node = schema as Record<string, unknown>;
  for (const key of Object.keys(node)) expect(KEYWORDS.has(key), `${at} has ${key}`).toBe(true);
  expect(TYPES.has(node.type as string), `${at}.type`).toBe(true);
  if (node.type === 'object') {
    expect(node.additionalProperties, `${at}.additionalProperties`).toBe(false);
    const properties = node.properties as Record<string, unknown>;
    for (const key of Object.keys(properties)) expectSchema(properties[key], `${at}.properties.${key}`);
    for (const key of (node.required as string[] | undefined) ?? []) expect(Object.hasOwn(properties, key), `${at} requires ${key}`).toBe(true);
  }
  if (node.items !== undefined) expectSchema(node.items, `${at}.items`);
}

describe('agent.tools', () => {
  it('is one frozen array of two tools for every agent, the action first', () => {
    const { tools } = createAgent();
    expect(createAgent().tools).toBe(tools);
    expect(tools.map((tool) => tool.name)).toEqual(['cloudlet_act', 'cloudlet_snapshot']);
    expect(Object.isFrozen(tools)).toBe(true);
    for (const tool of tools) {
      expect(Object.keys(tool)).toEqual(['name', 'description', 'inputSchema']);
      expect(tool.description.length).toBeGreaterThan(100);
      expect(Object.isFrozen(tool)).toBe(true);
      expect(Object.isFrozen(tool.inputSchema)).toBe(true);
      expect(JSON.parse(JSON.stringify(tool))).toEqual(tool);
      expectSchema(tool.inputSchema);
    }
  });

  it('describes the act input as steps of ref, action and args, at most MOST_STEPS of them', () => {
    const [act, snapshot] = createAgent().tools;
    expect(MOST_STEPS).toBe(20);
    expect(act!.inputSchema).toMatchObject({
      type: 'object',
      required: ['steps'],
      additionalProperties: false,
      properties: {
        steps: {
          type: 'array', minItems: 1, maxItems: MOST_STEPS,
          items: {
            type: 'object',
            required: ['ref', 'action'],
            additionalProperties: false,
            properties: { ref: { type: 'string' }, action: { type: 'string' }, args: { type: 'array' } },
          },
        },
      },
    });
    expect(snapshot!.inputSchema).toEqual({ type: 'object', properties: {}, additionalProperties: false });
  });

  it('keeps the schemas from being changed', () => {
    const [act] = createAgent().tools;
    const steps = (act!.inputSchema.properties as Record<string, Record<string, unknown>>).steps!;
    expect(Object.isFrozen(steps)).toBe(true);
    expect(Object.isFrozen(steps.items)).toBe(true);
  });
});

describe('agent.callTool: names', () => {
  it.each([
    ['cloudlet_query', 'Unknown tool "cloudlet_query". Tools: cloudlet_act, cloudlet_snapshot.'],
    ['snapshot', 'Unknown tool "snapshot". Tools: cloudlet_act, cloudlet_snapshot.'],
    [7, 'Unknown tool 7. Tools: cloudlet_act, cloudlet_snapshot.'],
    [undefined, 'Unknown tool undefined. Tools: cloudlet_act, cloudlet_snapshot.'],
    [{ toString: () => { throw new Error('no'); } }, 'Unknown tool a value of type object. Tools: cloudlet_act, cloudlet_snapshot.'],
  ])('answers an error for the name %j', async (name, message) => {
    const result = await createAgent().callTool(name as string, {});
    expect(result).toEqual({ ok: false, error: { message } });
    expect(Object.isFrozen(result)).toBe(true);
    expectPlain(result);
  });
});

describe('agent.callTool: cloudlet_snapshot', () => {
  it('answers the entries and the verbs of their kinds, for {} and for no input', async () => {
    const agent = createAgent();
    agent.connect(box().component);
    const expected = { entries: agent.snapshot(), verbs: { box: { press: 'Presses the box. No arguments.' } } };
    for (const input of [{}, undefined]) {
      const result = await agent.callTool('cloudlet_snapshot', input);
      expect(result).toEqual(expected);
      expect(Object.isFrozen(result)).toBe(true);
      expectPlain(result);
    }
    expect(await createAgent().callTool('cloudlet_snapshot', {})).toEqual({ entries: [], verbs: {} });
  });

  it.each([
    [{ ref: 'box' }, 'cloudlet_snapshot takes no input: send {}. It got the key "ref".'],
    [null, 'cloudlet_snapshot takes no input: send {}. It got null.'],
    [[], 'cloudlet_snapshot takes no input: send {}. It got a list.'],
    ['all', 'cloudlet_snapshot takes no input: send {}. It got "all".'],
  ])('refuses the input %j', async (input, message) => {
    const result = await createAgent().callTool('cloudlet_snapshot', input);
    expect(result).toEqual({ ok: false, error: { message } });
    expectPlain(result);
  });

  it('leaves out a key of a record that is not plain data, and reports it', async () => {
    const reported = captureReports();
    const agent = createAgent();
    agent.connect(box({ entries: [{ ref: 'box', component: 'box', actions: [], when: new Date(0), gone: undefined, label: 'Box' }] }).component);
    const result = await agent.callTool('cloudlet_snapshot');
    expect(result).toEqual({ entries: [{ ref: 'box', component: 'box', actions: [], label: 'Box' }], verbs: { box: { press: 'Presses the box. No arguments.' } } });
    expectPlain(result);
    expect(reported).toHaveLength(1);
    expect(String(reported[0])).toContain('"when"');
  });

  it('answers an error when a component cannot give its records', async () => {
    const reported = captureReports();
    const agent = createAgent();
    agent.connect({ ...box().component, snapshot: () => { throw new Error('broken'); } });
    const result = await agent.callTool('cloudlet_snapshot', {});
    expect(result).toEqual({ ok: false, error: { message: 'cloudlet_snapshot failed: a component could not give its records. Try again later.' } });
    expect(reported).toHaveLength(1);
  });
});

describe('agent.callTool: the cloudlet_act input', () => {
  it.each([
    [{ ref: 'box', action: 'press' }, 0, `a step came on its own; steps go in a list under "steps", even a single one: ${SHAPE}`],
    [[{ ref: 'box', action: 'press' }], 0, `expected an object with steps, not a bare list: ${SHAPE}`],
    ['press the box', 0, `expected an object with steps: ${SHAPE}`],
    [{ steps: { ref: 'box', action: 'press' } }, 0, `steps must be a list, even for a single step: ${SHAPE}`],
    [{ steps: [{ ref: 'box', action: 'fill', value: 'x' }] }, 0, `steps[0] has "value", which a step doesn't take: ${ARGS}`],
    [{ steps: [{ ref: 'box', action: 'press' }, { ref: 'box', action: 'fill', args: 'x' }] }, 1, `steps[1].args is not a list: ${ARGS}`],
    [{ steps: [{ action: 'press' }] }, 0, 'steps[0] has no "ref"; give it a ref from cloudlet_snapshot'],
    [{ steps: [{ ref: 'box' }] }, 0, 'steps[0] has no "action"; give it a verb from the record\'s actions'],
    [{ steps: [{ ref: 'box', verb: 'press' }] }, 0, 'steps[0] has an unknown key "verb"; a step takes only "ref", "action" and "args"'],
  ])('refuses %j with what to change, and act says the same', async (input, step, problem) => {
    const { component, run } = box();
    const agent = createAgent();
    agent.connect(component);
    const message = `Invalid call: ${problem}. No step ran.`;
    const result = await agent.callTool('cloudlet_act', input);
    expect(result).toEqual({ ok: false, error: { step, message }, steps: [], changes: [] });
    expect(Object.isFrozen(result)).toBe(true);
    expectPlain(result);
    expect(await agent.act(input as never)).toEqual({ ok: false, error: { step, message }, steps: [] });
    expect(run).not.toHaveBeenCalled();
  });

  it(`runs ${MOST_STEPS} steps in one call and refuses ${MOST_STEPS + 1} before any runs, in act too`, async () => {
    const { component, run } = box();
    const agent = createAgent();
    agent.connect(component);
    const steps = (count: number) => ({ steps: Array.from({ length: count }, () => ({ ref: 'box', action: 'press' })) });

    const most = await agent.callTool('cloudlet_act', steps(MOST_STEPS));
    expect(most.ok && most.steps).toHaveLength(MOST_STEPS);
    expect(run).toHaveBeenCalledTimes(MOST_STEPS);
    run.mockClear();

    const message = 'Invalid call: 21 steps is more than 20 in one call; split them into calls of at most 20 steps. No step ran.';
    expect(await agent.callTool('cloudlet_act', steps(MOST_STEPS + 1))).toEqual({ ok: false, error: { step: 0, message }, steps: [], changes: [] });
    expect(await agent.act(steps(MOST_STEPS + 1))).toEqual({ ok: false, error: { step: 0, message }, steps: [] });
    expect(run).not.toHaveBeenCalled();
  });

  it('answers an invalid call for input it cannot read, without rejecting', async () => {
    const input = { get steps(): never { throw new Error('no'); } };
    const result = await createAgent().callTool('cloudlet_act', input);
    expect(result).toEqual({ ok: false, error: { step: 0, message: 'Invalid call: its input could not be read. No step ran.' }, steps: [], changes: [] });
  });
});

describe('agent.callTool: the changes of a cloudlet_act call', () => {
  it('answers the result with the changes heard while the call ran', async () => {
    const thing = box();
    thing.run.mockImplementation(() => { thing.emit(change('pressed', 'agent')); return { status: 'done', result: 'started' }; });
    const agent = createAgent();
    agent.connect(thing.component);
    thing.emit(change('before'));
    const result = await agent.callTool('cloudlet_act', { steps: [{ ref: 'box', action: 'press' }] });
    expect(result).toEqual({ ok: true, steps: [{ step: 0, ref: 'box', result: 'started' }], changes: [change('pressed', 'agent')] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen((result as AgentActToolResult).changes)).toBe(true);
    expectPlain(result);
  });

  it('keeps the changes of two queued calls apart, a person\'s change during allow going to the call that waits', async () => {
    const answers: ReturnType<typeof deferred<boolean>>[] = [];
    const allow = vi.fn<Allow>(() => { const answer = deferred<boolean>(); answers.push(answer); return answer.promise; });
    const thing = box();
    let presses = 0;
    thing.run.mockImplementation(() => { presses += 1; thing.emit(change(`press ${presses}`, 'agent')); return { status: 'done' }; });
    const agent = createAgent({ allow });
    agent.connect(thing.component);
    const call = { steps: [{ ref: 'box', action: 'press' }] };

    const first = agent.callTool('cloudlet_act', call);
    const second = agent.callTool('cloudlet_act', call);
    await settle();
    expect(allow).toHaveBeenCalledTimes(1);
    thing.emit(change('closed by hand'));
    answers[0]!.resolve(true);
    const firstResult = await first;
    expect(firstResult.changes).toEqual([change('closed by hand'), change('press 1', 'agent')]);

    await settle();
    thing.emit(change('while the second waits'));
    answers[1]!.resolve(true);
    expect((await second).changes).toEqual([change('while the second waits'), change('press 2', 'agent')]);
  });

  it('holds no subscription after it answers', async () => {
    const thing = box();
    const agent = createAgent();
    agent.connect(thing.component);
    const realMicrotask = queueMicrotask;
    // The bridge rethrows a listener's error in a microtask: a listener left behind would push into a frozen array.
    const rethrown = vi.fn((callback: () => void) => { realMicrotask(callback); });
    vi.stubGlobal('queueMicrotask', rethrown);
    thing.run.mockImplementation(() => { thing.emit(change('pressed', 'agent')); return { status: 'done' }; });
    const result = await agent.callTool('cloudlet_act', { steps: [{ ref: 'box', action: 'press' }] });
    const empty = await agent.callTool('cloudlet_act', { steps: [{ ref: 'nowhere', action: 'press' }] });
    thing.emit(change('later'));
    expect(rethrown).not.toHaveBeenCalled();
    expect(result.changes).toEqual([change('pressed', 'agent')]);
    expect(empty.changes).toEqual([]);
  });

  it('collects nothing for a call cancelled while it waits for its turn', async () => {
    const answer = deferred<boolean>();
    const agent = createAgent({ allow: () => answer.promise });
    const thing = box();
    agent.connect(thing.component);
    const call = { steps: [{ ref: 'box', action: 'press' }] };
    const first = agent.callTool('cloudlet_act', call);
    const controller = new AbortController();
    const second = agent.callTool('cloudlet_act', call, { signal: controller.signal });
    await settle();
    controller.abort();
    const cancelled = await second;
    expect(cancelled).toEqual({ ok: false, error: { step: 0, message: 'Cancelled before "press" on "box" ran.' }, steps: [], changes: [] });
    thing.emit(change('closed by hand'));
    answer.resolve(true);
    expect((await first).changes).toEqual([change('closed by hand')]);
    expect(cancelled.changes).toEqual([]);
  });

  it('collects nothing for a call whose signal was aborted before it was made', async () => {
    const thing = box();
    const agent = createAgent();
    agent.connect(thing.component);
    const result = await agent.callTool('cloudlet_act', { steps: [{ ref: 'box', action: 'press' }] }, { signal: AbortSignal.abort() });
    expect(result).toEqual({ ok: false, error: { step: 0, message: 'Cancelled before "press" on "box" ran.' }, steps: [], changes: [] });
    expect(thing.run).not.toHaveBeenCalled();
  });

  it('stops collecting when a step is cancelled while it runs', async () => {
    const thing = box({ run: () => new Promise<AgentRunOutcome>(() => {}) });
    const agent = createAgent();
    agent.connect(thing.component);
    const controller = new AbortController();
    const pending = agent.callTool('cloudlet_act', { steps: [{ ref: 'box', action: 'press' }] }, { signal: controller.signal });
    await settle();
    thing.emit(change('during'));
    controller.abort();
    const result = await pending;
    thing.emit(change('after'));
    expect(result).toEqual({
      ok: false, error: { step: 0, message: 'Cancelled while "press" on "box" was running. It may still finish.' }, steps: [], changes: [change('during')],
    });
    expectPlain(result);
  });
});
