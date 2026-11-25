import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgent, type AgentComponent, type AgentEntry } from '@cloudlet/agent';

/** A stand-in for a component adapter: its records are set by hand and `emit` reports a change. */
function fake(name: string, entries: AgentEntry[] = [{ ref: name, component: name, actions: [] }]) {
  const listeners = new Set<() => void>();
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
    emit() { for (const listener of [...listeners]) listener(); },
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
    expect(listener).toHaveBeenLastCalledWith();
    component.emit();
    expect(listener).toHaveBeenCalledTimes(2);
    disconnect();
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    agent.connect(fake('two').component);
    expect(listener).toHaveBeenCalledTimes(3);
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
