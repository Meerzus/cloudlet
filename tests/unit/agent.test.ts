import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgent, type AgentChange, type AgentComponent, type AgentEntry } from '@cloudlet/agent';

/** A stand-in for a component adapter: its records are set by hand and `emit` reports a change. */
function fake(name: string, entries: AgentEntry[] = [{ ref: name, component: name, actions: [] }]) {
  const listeners = new Set<(changes?: readonly AgentChange[]) => void>();
  let records: readonly AgentEntry[] = entries;
  const component: AgentComponent = {
    protocol: 1,
    name,
    snapshot: () => records,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  return {
    component,
    listeners,
    set(next: AgentEntry[]) { records = next; },
    emit(changes?: readonly AgentChange[]) { for (const listener of [...listeners]) if (changes) listener(changes); else listener(); },
  };
}

const entry = (ref: string, extra: Record<string, unknown> = {}): AgentEntry => ({ ref, component: 'item', actions: [], ...extra });

afterEach(() => { vi.unstubAllGlobals(); });

describe('createAgent', () => {
  it('starts with an empty frozen snapshot and exports only createAgent', async () => {
    const agent = createAgent();
    expect(agent.snapshot()).toEqual([]);
    expect(Object.isFrozen(agent.snapshot())).toBe(true);
    expect(Object.keys(await import('@cloudlet/agent'))).toEqual(['createAgent']);
  });

  it('lists the records of every component in connection order', () => {
    const agent = createAgent();
    agent.connect(fake('second', [entry('second:1'), entry('second:2')]).component);
    agent.connect(fake('first', [entry('first:1')]).component);
    expect(agent.snapshot().map((record) => record.ref)).toEqual(['second:1', 'second:2', 'first:1']);
  });

  it('returns the same array until a component reports a change', () => {
    const agent = createAgent();
    const component = fake('toaster', [entry('a')]);
    agent.connect(component.component);
    const first = agent.snapshot();
    expect(agent.snapshot()).toBe(first);

    component.set([entry('b')]);
    expect(agent.snapshot()).toBe(first);
    component.emit();
    const second = agent.snapshot();
    expect(second).not.toBe(first);
    expect(second.map((record) => record.ref)).toEqual(['b']);
    expect(Object.isFrozen(second)).toBe(true);
  });

  it('returns a new array after a connection and after a disconnection', () => {
    const agent = createAgent();
    const empty = agent.snapshot();
    const disconnect = agent.connect(fake('one').component);
    const connected = agent.snapshot();
    expect(connected).not.toBe(empty);
    disconnect();
    expect(agent.snapshot()).not.toBe(connected);
    expect(agent.snapshot()).toEqual([]);
  });

  it('notifies subscribers on a change, a connection and a disconnection, until they unsubscribe', () => {
    const agent = createAgent();
    const listener = vi.fn();
    const unsubscribe = agent.subscribe(listener);
    const component = fake('one');
    const disconnect = agent.connect(component.component);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith([]);
    component.emit();
    expect(listener).toHaveBeenCalledTimes(2);
    disconnect();
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    agent.connect(fake('two').component);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('hands a subscriber what the component said about the change, copied and frozen', () => {
    const agent = createAgent();
    const component = fake('one');
    agent.connect(component.component);
    const seen: (readonly AgentChange[])[] = [];
    agent.subscribe((changes) => { seen.push(changes); });
    const nested = { open: true };
    const reported: AgentChange[] = [
      { ref: 'one:1', component: 'item', label: 'Saved', key: 'present', value: false, previous: true, reason: 'programmatic', source: 'agent' },
      { ref: 'one', component: 'one', key: 'state', value: nested, previous: null, source: 'user' },
    ];
    component.emit(reported);
    expect(seen).toEqual([reported]);
    const [changes] = seen;
    expect(changes).not.toBe(reported);
    expect(changes![0]).not.toBe(reported[0]);
    expect(Object.isFrozen(changes)).toBe(true);
    expect(changes!.every((change) => Object.isFrozen(change))).toBe(true);
    expect(changes![1]!.value).not.toBe(nested);
    expect(Object.isFrozen(changes![1]!.value)).toBe(true);
    // What the component does to its own objects later does not reach the listener's copy.
    (reported[0] as { source: string }).source = 'user';
    nested.open = false;
    expect(changes![0]!.source).toBe('agent');
    expect(changes![1]!.value).toEqual({ open: true });
    // A record keeps only the protocol's keys, and no key it did not have.
    expect(Object.keys(changes![1]!)).toEqual(['ref', 'component', 'key', 'value', 'previous', 'source']);
  });

  it('hands an empty frozen array when the component says nothing, connects or disconnects', () => {
    const agent = createAgent();
    const seen: (readonly AgentChange[])[] = [];
    agent.subscribe((changes) => { seen.push(changes); });
    const component = fake('one');
    const disconnect = agent.connect(component.component);
    component.emit();
    component.emit([]);
    disconnect();
    expect(seen).toEqual([[], [], [], []]);
    expect(seen.every((changes) => Object.isFrozen(changes))).toBe(true);
  });

  it('leaves out a change of an unknown shape, reports it, and still delivers the rest', () => {
    const reported: unknown[] = [];
    vi.stubGlobal('console', { ...console, error: (error: unknown) => { reported.push(error); } });
    const agent = createAgent();
    const component = fake('one');
    agent.connect(component.component);
    const listener = vi.fn();
    agent.subscribe(listener);
    const good: AgentChange = { ref: 'one', component: 'one', key: 'open', value: true, previous: false, source: 'app' };
    const sparse: unknown[] = [good];
    sparse[2] = good;
    const bad: unknown[] = [
      null, 'text', { ...good, ref: 1 }, { ...good, source: 'timer' }, { ...good, label: 2 }, { ...good, reason: null },
      { ...good, value: undefined }, { ...good, previous: () => {} }, { ...good, value: Number.NaN },
      { get ref(): string { throw new Error('getter'); } },
    ];
    component.emit([...bad, good] as never);
    expect(listener).toHaveBeenLastCalledWith([good]);
    expect(reported).toHaveLength(bad.length);
    expect(String(reported[2])).toBe('TypeError: Component "one" reported a change of an unknown shape at index 2: a field is missing or of another type');

    // What a getter throws may not turn into text; the records after it still arrive.
    reported.length = 0;
    component.emit([good, { get ref(): string { throw Object.create(null); } }, good] as never);
    expect(listener).toHaveBeenLastCalledWith([good, good]);
    expect(String(reported[0])).toMatch(/at index 1: reading it failed$/u);
    // A list no commit could produce is refused whole, in one report.
    component.emit(new Array(1_001).fill(good) as never);
    expect(listener).toHaveBeenLastCalledWith([]);
    expect(reported).toHaveLength(2);
    reported.length = bad.length;

    component.emit(sparse as never);
    expect(listener).toHaveBeenLastCalledWith([good, good]);
    // Not an array at all: the listeners still hear that something changed.
    component.emit({ length: 1, 0: good } as never);
    expect(listener).toHaveBeenLastCalledWith([]);
    expect(listener).toHaveBeenCalledTimes(5);
    expect(reported).toHaveLength(bad.length + 2);
  });

  it('delivers the changes of two components separately, each with its own records', () => {
    const agent = createAgent();
    const one = fake('one');
    const two = fake('two');
    agent.connect(one.component);
    agent.connect(two.component);
    const seen: string[][] = [];
    agent.subscribe((changes) => { seen.push(changes.map((change) => `${change.ref} ${change.source}`)); });
    one.emit([{ ref: 'one', component: 'one', key: 'open', value: true, previous: false, source: 'user' }]);
    two.emit([{ ref: 'two', component: 'two', key: 'open', value: true, previous: false, source: 'system' }]);
    expect(seen).toEqual([['one user'], ['two system']]);
  });

  it('keeps working as a store: a listener without parameters and an unchanged snapshot identity', () => {
    const agent = createAgent();
    const component = fake('one');
    agent.connect(component.component);
    const plain: () => void = vi.fn();
    const unsubscribe: () => void = agent.subscribe(plain);
    const before = agent.snapshot();
    expect(agent.snapshot()).toBe(before);
    component.emit([{ ref: 'one', component: 'one', key: 'open', value: true, previous: false, source: 'user' }]);
    expect(plain).toHaveBeenCalledTimes(1);
    expect(agent.snapshot()).not.toBe(before);
    unsubscribe();
  });

  it('lets a listener read the fresh snapshot', () => {
    const agent = createAgent();
    const component = fake('one', [entry('a')]);
    agent.connect(component.component);
    const seen: string[][] = [];
    agent.subscribe(() => { seen.push(agent.snapshot().map((record) => record.ref)); });
    component.set([entry('b')]);
    component.emit();
    expect(seen).toEqual([['b']]);
  });

  it('runs every listener when one throws and reports the error afterwards', () => {
    const reported: Array<() => void> = [];
    vi.stubGlobal('queueMicrotask', (callback: () => void) => { reported.push(callback); });
    const agent = createAgent();
    const failure = new Error('listener failed');
    const after = vi.fn();
    agent.subscribe(() => { throw failure; });
    agent.subscribe(after);

    const disconnect = agent.connect(fake('one').component);
    expect(after).toHaveBeenCalledTimes(1);
    expect(typeof disconnect).toBe('function');
    expect(reported).toHaveLength(1);
    expect(() => reported[0]!()).toThrow(failure);
  });

  it('disconnects idempotently and stops listening to the component', () => {
    const agent = createAgent();
    const listener = vi.fn();
    agent.subscribe(listener);
    const component = fake('one');
    const disconnect = agent.connect(component.component);
    expect(component.listeners.size).toBe(1);

    disconnect();
    disconnect();
    expect(component.listeners.size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(agent.snapshot()).toEqual([]);
  });

  it('ignores a late change from a disconnected component', () => {
    const agent = createAgent();
    let late: (() => void) | undefined;
    const component: AgentComponent = { ...fake('one').component, subscribe: (listener) => { late = listener; return () => {}; } };
    const disconnect = agent.connect(component);
    disconnect();
    const listener = vi.fn();
    agent.subscribe(listener);
    const snapshot = agent.snapshot();
    late!();
    expect(listener).not.toHaveBeenCalled();
    expect(agent.snapshot()).toBe(snapshot);
  });

  it('frees a name on disconnect, so it can be connected again', () => {
    const agent = createAgent();
    const disconnect = agent.connect(fake('toaster').component);
    disconnect();
    expect(() => agent.connect(fake('toaster').component)).not.toThrow();
  });

  it('throws a TypeError on an unknown protocol', () => {
    const agent = createAgent();
    const component = { ...fake('one').component, protocol: 2 } as unknown as AgentComponent;
    expect(() => agent.connect(component)).toThrow(TypeError);
    expect(agent.snapshot()).toEqual([]);
  });

  it.each(['', 'Toaster', '1toaster', 'toast_er', 'toaster:1', '-toaster', ' toaster'])('throws a TypeError on the name %j', (name) => {
    const agent = createAgent();
    expect(() => agent.connect(fake(name).component)).toThrow(TypeError);
  });

  it('accepts names of lowercase letters, digits and hyphens', () => {
    const agent = createAgent();
    for (const name of ['toaster', 'secondary', 'color-picker', 'a1']) agent.connect(fake(name).component);
    expect(agent.snapshot()).toHaveLength(4);
  });

  it('throws a TypeError on a name that is already connected, and keeps the first', () => {
    const agent = createAgent();
    const listener = vi.fn();
    agent.connect(fake('toaster', [entry('first')]).component);
    agent.subscribe(listener);
    const duplicate = fake('toaster', [entry('second')]);
    expect(() => agent.connect(duplicate.component)).toThrow(TypeError);
    expect(duplicate.listeners.size).toBe(0);
    expect(listener).not.toHaveBeenCalled();
    expect(agent.snapshot().map((record) => record.ref)).toEqual(['first']);
  });

  it('works without window and document', () => {
    expect(typeof globalThis.window).toBe('undefined');
    expect(typeof globalThis.document).toBe('undefined');
    const agent = createAgent();
    const component = fake('toaster', [entry('toaster', { open: false })]);
    agent.connect(component.component);
    component.set([entry('toaster', { open: true })]);
    component.emit();
    expect(agent.snapshot()).toEqual([entry('toaster', { open: true })]);
  });
});
