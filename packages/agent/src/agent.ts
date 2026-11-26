import { cancelledBefore, failed, parseCall, runSteps, type ActEnvironment, type Located } from './act.js';
import type { ActResult, Agent, AgentComponent, AgentEntry, AgentOptions } from './types.js';

const NAME = /^[a-z][a-z0-9-]*$/;
const DEFAULT_TIMEOUT = 300_000;
// Timers fire at once past this many milliseconds, so a longer timeout waits this long instead.
const LONGEST_TIMER = 2_147_483_647;

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
  const { check, run, summon } = component;
  if ((check === undefined) !== (run === undefined)) {
    throw new TypeError(`Component "${component.name}" must provide check() and run() together`);
  }
  for (const [key, method] of [['check', check], ['run', run], ['summon', summon]] as const) {
    if (method !== undefined && typeof method !== 'function') throw new TypeError(`Component "${component.name}": ${key} must be a function`);
  }
}

function readOptions(options: AgentOptions | undefined): Pick<ActEnvironment, 'allow' | 'timeout'> {
  if (options === undefined) return { allow: undefined, timeout: DEFAULT_TIMEOUT };
  if (options === null || typeof options !== 'object') throw new TypeError('createAgent expects an options object');
  const { allow, timeout = DEFAULT_TIMEOUT } = options;
  if (allow !== undefined && typeof allow !== 'function') throw new TypeError('allow must be a function');
  if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) {
    throw new TypeError(`timeout must be a finite positive number of milliseconds: ${String(timeout)}`);
  }
  return { allow, timeout: Math.min(timeout, LONGEST_TIMER) };
}

/**
 * Creates the kit's bridge. It touches no DOM and starts no timers until a step waits, so it can be
 * created on the server or before any component mounts.
 *
 * @throws TypeError when `allow` is not a function or `timeout` is not a finite positive number.
 * @experimental The protocol may change in any 0.x release.
 */
export function createAgent(options?: AgentOptions): Agent {
  const { allow, timeout } = readOptions(options);
  // A Map keeps insertion order, which is the snapshot's order.
  const connections = new Map<string, Connection>();
  const listeners = new Set<() => void>();
  let cached: readonly AgentEntry[] | undefined;
  // The end of the last queued call: calls run one at a time, in the order they were made.
  let queue: Promise<unknown> = Promise.resolve();

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

  // Each component's own snapshot, read now: a step never trusts a cached list.
  const environment: ActEnvironment = {
    locate: (ref) => {
      for (const connection of connections.values()) {
        const entry = connection.component.snapshot().find((record) => record.ref === ref);
        if (entry) {
          const { name } = connection.component;
          return { found: true, component: connection.component, entry, live: () => connections.get(name) === connection } satisfies Located;
        }
      }
      return { found: false };
    },
    refs: () => [...connections.values()].flatMap(({ component }) => component.snapshot().map((record) => record.ref)),
    allow,
    timeout,
    report,
  };

  const act: Agent['act'] = (input, actOptions) => {
    const call = parseCall(input, actOptions);
    if (!('steps' in call)) return Promise.resolve(failed(call.step, call.message));
    const { steps, signal } = call;
    const first = steps[0]!;
    if (signal?.aborted) return Promise.resolve(failed(0, cancelledBefore(first)));
    return new Promise<ActResult>((resolve) => {
      let started = false;
      // Cancelled while it waits for its turn: answer now; its turn then finds the signal aborted.
      const cancel = (): void => { if (!started) resolve(failed(0, cancelledBefore(first))); };
      signal?.addEventListener('abort', cancel, { once: true });
      const turn = queue.then(() => {
        started = true;
        signal?.removeEventListener('abort', cancel);
        return runSteps(steps, signal, environment);
      }).catch((error: unknown) => {
        // Unreachable unless the bridge itself is broken; the call still settles.
        report(error);
        return failed(0, 'The agent bridge failed. No further step ran.');
      });
      queue = turn;
      void turn.then(resolve);
    });
  };

  return Object.freeze({ connect, snapshot, subscribe, act });
}
