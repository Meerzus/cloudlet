import type { Agent, AgentComponent, AgentEntry } from './types.js';

const NAME = /^[a-z][a-z0-9-]*$/;

// Every runtime the kit supports has it; the package is typed without DOM or Node globals.
declare const queueMicrotask: (callback: () => void) => void;

/** Surfaces a listener's error the way EventTarget does: uncaught, after the others have run. */
function report(error: unknown): void {
  queueMicrotask(() => { throw error; });
}

interface Connection {
  readonly component: AgentComponent;
  readonly unsubscribe: () => void;
}

function validate(component: AgentComponent, connections: ReadonlyMap<string, Connection>): void {
  if (component === null || typeof component !== 'object') throw new TypeError('connect expects a component object');
  if (component.protocol !== 1) throw new TypeError(`Unknown agent protocol: ${String(component.protocol)}`);
  if (typeof component.name !== 'string' || !NAME.test(component.name)) {
    throw new TypeError(`Component name must match [a-z][a-z0-9-]*: ${String(component.name)}`);
  }
  if (connections.has(component.name)) throw new TypeError(`A component named "${component.name}" is already connected`);
  if (typeof component.snapshot !== 'function' || typeof component.subscribe !== 'function') {
    throw new TypeError(`Component "${component.name}" must provide snapshot() and subscribe()`);
  }
}

/**
 * Creates the kit's bridge. It touches no DOM and starts no timers, so it can be created on the
 * server or before any component mounts.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export function createAgent(): Agent {
  // A Map keeps insertion order, which is the snapshot's order.
  const connections = new Map<string, Connection>();
  const listeners = new Set<() => void>();
  let cached: readonly AgentEntry[] | undefined;

  function changed(): void {
    cached = undefined;
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try { listener(); } catch (error) { report(error); }
    }
  }

  const connect: Agent['connect'] = (component) => {
    validate(component, connections);
    const { name } = component;
    let connection: Connection | undefined;
    const unsubscribe = component.subscribe(() => {
      // A late call from a component that was already disconnected changes nothing.
      if (connection && connections.get(name) === connection) changed();
    });
    connection = { component, unsubscribe };
    connections.set(name, connection);
    let connected = true;
    changed();
    return () => {
      if (!connected) return;
      connected = false;
      connections.delete(name);
      unsubscribe();
      changed();
    };
  };

  const snapshot: Agent['snapshot'] = () => {
    if (cached) return cached;
    const entries: AgentEntry[] = [];
    for (const { component } of connections.values()) entries.push(...component.snapshot());
    cached = Object.freeze(entries);
    return cached;
  };

  const subscribe: Agent['subscribe'] = (listener) => {
    const own = (): void => { listener(); };
    listeners.add(own);
    return () => { listeners.delete(own); };
  };

  return Object.freeze({ connect, snapshot, subscribe });
}
