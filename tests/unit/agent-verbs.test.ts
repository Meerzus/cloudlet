import { describe, expect, it } from 'vitest';
import { createAgent, type AgentComponent, type AgentEntry, type AgentVerbs } from '@cloudlet/agent';
import { collectVerbs, verbsOf } from '../../packages/agent/src/verbs.js';
import { toasterAgent } from '../../packages/toast/src/agent.js';
import { admit, attach, harness } from '../support/controller-harness.js';

/** A read-only component with fixed records and the given `verbs`. */
const component = (name: string, entries: AgentEntry[], verbs?: unknown): AgentComponent => ({
  protocol: 1,
  name,
  snapshot: () => entries,
  subscribe: () => () => {},
  ...(verbs === undefined ? {} : { verbs: verbs as AgentVerbs }),
});
const record = (ref: string, kind: string, actions: string[] = []): AgentEntry => ({ ref, component: kind, actions });

describe('verbs in the component protocol', () => {
  it('accepts a component without verbs and one with an object of descriptions by kind', () => {
    const agent = createAgent();
    expect(() => agent.connect(component('plain', [record('plain', 'plain')]))).not.toThrow();
    expect(() => agent.connect(component('list', [record('list', 'list', ['add'])], { list: { add: 'args [text]. Adds it.' }, other: {} }))).not.toThrow();
    expect(agent.snapshot()).toHaveLength(2);
  });

  it.each([
    ['null', null],
    ['a string', 'add: adds'],
    ['an array', [{ add: 'Adds.' }]],
    ['a kind that is not an object', { list: 'Adds.' }],
    ['a kind that is an array', { list: ['Adds.'] }],
    ['an empty kind', { '': { add: 'Adds.' } }],
    ['an empty verb', { list: { '': 'Adds.' } }],
    ['a description that is not a string', { list: { add: 1 } }],
    ['an empty description', { list: { add: '  ' } }],
  ])('throws a TypeError for verbs that are %s and does not connect', (_, verbs) => {
    const agent = createAgent();
    let subscribed = false;
    const broken: AgentComponent = { ...component('list', [record('list', 'list')], verbs), subscribe: () => { subscribed = true; return () => {}; } };
    expect(() => agent.connect(broken)).toThrow(TypeError);
    expect(() => agent.connect(broken)).toThrow(/^Component "list": /);
    expect(subscribed).toBe(false);
    expect(agent.snapshot()).toEqual([]);
  });

  it('keeps a frozen copy made at connection, so a later change of the object is not seen', () => {
    const agent = createAgent();
    const verbs: Record<string, Record<string, string>> = { list: { add: 'Adds.' } };
    agent.connect(component('list', [record('list', 'list', ['add'])], verbs));
    verbs.list!.add = 'Changed.';
    verbs.list!.remove = 'Removes.';
    const described = verbsOf(agent);
    expect(described).toEqual({ list: { add: 'Adds.' } });
    expect(Object.isFrozen(described)).toBe(true);
    expect(Object.isFrozen(described.list)).toBe(true);
    expect(structuredClone(described)).toEqual(JSON.parse(JSON.stringify(described)));
  });

  it('keeps a kind or verb named __proto__ as a key', () => {
    const agent = createAgent();
    const verbs = JSON.parse('{"__proto__":{"__proto__":"Odd."}}') as AgentVerbs;
    agent.connect(component('odd', [record('odd', '__proto__')], verbs));
    const described = verbsOf(agent);
    expect(Object.keys(described)).toEqual(['__proto__']);
    expect(Object.getOwnPropertyDescriptor(described, '__proto__')?.value).toEqual(JSON.parse('{"__proto__":"Odd."}'));
  });
});

describe('verbs of the kinds in the snapshot', () => {
  it('describes each kind in the snapshot once, in the order kinds first appear, and leaves out the rest', () => {
    const agent = createAgent();
    agent.connect(component('list', [record('list', 'list'), record('list:1', 'item'), record('list:2', 'item')], {
      item: { remove: 'Removes it.' }, list: { add: 'Adds one.' }, ghost: { haunt: 'Never shown.' },
    }));
    agent.connect(component('plain', [record('plain', 'plain')]));
    const described = verbsOf(agent);
    expect(described).toEqual({ list: { add: 'Adds one.' }, item: { remove: 'Removes it.' } });
    expect(Object.keys(described)).toEqual(['list', 'item']);
  });

  it('follows connections and disconnections', () => {
    const agent = createAgent();
    expect(verbsOf(agent)).toEqual({});
    const disconnect = agent.connect(component('list', [record('list', 'list')], { list: { add: 'Adds.' } }));
    expect(verbsOf(agent)).toEqual({ list: { add: 'Adds.' } });
    disconnect();
    expect(verbsOf(agent)).toEqual({});
  });

  it('takes a kind two components describe from the one connected first', () => {
    const agent = createAgent();
    agent.connect(component('first', [record('first:1', 'item')], { item: { press: 'First words.' } }));
    agent.connect(component('second', [record('second:1', 'item')], { item: { press: 'Second words.', extra: 'Only here.' } }));
    expect(verbsOf(agent)).toEqual({ item: { press: 'First words.' } });
  });

  it('takes a kind from a later component when the first one does not describe it', () => {
    expect(collectVerbs([record('a', 'item')], [undefined, { other: { x: 'X.' } }, { item: { y: 'Y.' } }])).toEqual({ item: { y: 'Y.' } });
  });

  it('answers empty for an object no agent made', () => {
    // A copy has every function of an agent, but no agent made it.
    expect(verbsOf({ ...createAgent() })).toEqual({});
  });
});

describe('toasterAgent verbs', () => {
  it('describes every verb of the toaster and notification records', () => {
    const { controller } = harness();
    const { verbs } = toasterAgent(controller);
    expect(Object.keys(verbs)).toEqual(['toaster', 'notification']);
    expect(Object.keys(verbs.toaster!).sort()).toEqual(['acknowledge', 'clear', 'close', 'open']);
    expect(Object.keys(verbs.notification!).sort()).toEqual(['cancel', 'dismiss', 'fill', 'press', 'retry', 'show', 'submit']);
    expect(Object.isFrozen(verbs) && Object.isFrozen(verbs.toaster) && Object.isFrozen(verbs.notification)).toBe(true);
    expect(verbs.notification!.fill).toMatch(/field name, text/);
    expect(verbs.notification!.fill).toMatch(/not its label/);
    expect(verbs.notification!.press).toMatch(/person/);
    expect(verbs.notification!.press).toMatch(/action\.href/);
    expect(verbs.notification!.submit).toMatch(/person/);
  });

  it('reaches the bridge, which describes every verb the snapshot lists', () => {
    const { controller, bridge } = harness();
    attach(bridge);
    admit(controller, { id: 'command', title: 'Deleted', duration: null, attention: 'stack', action: { kind: 'command', label: 'Undo', run: () => {} } });
    admit(controller, { id: 'link', title: 'Docs', duration: null, attention: 'stack', action: { kind: 'link', label: 'Open', href: 'https://example.com' } });
    admit(controller, {
      id: 'form', title: 'Reply', duration: null, attention: 'stack',
      action: { kind: 'form', label: 'Send', run: () => {}, fields: [{ name: 'reply', kind: 'text', label: 'Reply' }] },
    });
    const agent = createAgent();
    agent.connect(toasterAgent(controller));
    const described = verbsOf(agent);
    expect(Object.keys(described)).toEqual(['toaster', 'notification']);
    const listed = agent.snapshot().flatMap((entry) => entry.actions.map((verb) => [entry.component, verb] as const));
    expect(listed.length).toBeGreaterThan(5);
    for (const [kind, verb] of listed) expect(described[kind]?.[verb], `${kind} ${verb}`).toEqual(expect.any(String));
  });

  it('takes the notification verbs of two Toasters from the first', () => {
    const { controller } = harness();
    const agent = createAgent();
    const first = toasterAgent(controller);
    agent.connect(first);
    agent.connect(toasterAgent(harness().controller, { name: 'secondary' }));
    expect(verbsOf(agent)).toEqual({ toaster: first.verbs.toaster });
  });
});
