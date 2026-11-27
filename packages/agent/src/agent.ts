import { cancelledBefore, cloneValue, failed, parseCall, runSteps, type ActEnvironment, type Located } from './act.js';
import type { ActResult, Agent, AgentChange, AgentComponent, AgentEntry, AgentOptions } from './types.js';

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

declare const document: object | undefined;
declare const reportError: ((error: unknown) => void) | undefined;
declare const console: { error(...data: unknown[]): void } | undefined;

/**
 * Surfaces an error from `allow` or a component during `act` without ending the process: the call
 * already answers with a refusal, and an uncaught error outside a page stops the runtime before
 * the caller reads it. A page gets it as an `error` event, any other runtime in its console.
 */
function note(error: unknown): void {
  try {
    if (typeof document === 'object' && typeof reportError === 'function') reportError(error);
    else if (typeof console === 'object') console.error(error);
  } catch { /* A broken error channel must not break the call. */ }
}

const NO_CHANGES: readonly AgentChange[] = Object.freeze([]);
// One commit of a component changes a handful of records; a longer list is a broken component.
const MOST_CHANGES = 1_000;
const SOURCES: readonly unknown[] = ['user', 'agent', 'app', 'system'];
const optionalText = (value: unknown): value is string | undefined => value === undefined || typeof value === 'string';

/**
 * Copies what a component said about a change: each record is rebuilt from its known keys and
 * frozen, so a listener holds plain data the component cannot alter later. A record of another
 * shape is left out and reported; the rest still reach the listeners.
 */
function readChanges(name: string, input: unknown): readonly AgentChange[] {
  if (input === undefined) return NO_CHANGES;
  const changes: AgentChange[] = [];
  try {
    if (!Array.isArray(input)) throw new TypeError(`Component "${name}" reported changes that are not an array`);
    if (input.length > MOST_CHANGES) throw new TypeError(`Component "${name}" reported more than ${MOST_CHANGES} changes at once`);
    for (let index = 0; index < input.length; index += 1) {
      try {
        // A hole would read whatever the prototype holds at that index.
        const item: unknown = Object.hasOwn(input, index) ? input[index] : undefined;
        if (item === null || typeof item !== 'object') throw new TypeError('not an object');
        const { ref, component, label, key, value, previous, reason, source } = item as Record<string, unknown>;
        if (typeof ref !== 'string' || typeof component !== 'string' || typeof key !== 'string'
          || !optionalText(label) || !optionalText(reason) || !SOURCES.includes(source)) throw new TypeError('a field is missing or of another type');
        changes.push(Object.freeze({
          ref, component, ...(label === undefined ? {} : { label }), key,
          value: cloneValue(value), previous: cloneValue(previous),
          ...(reason === undefined ? {} : { reason }), source: source as AgentChange['source'],
        }));
      } catch (error) {
        // What was thrown may not turn into text at all.
        let why = 'reading it failed';
        try { if (error instanceof Error) why = error.message; } catch { /* Keeps the default. */ }
        note(new TypeError(`Component "${name}" reported a change of an unknown shape at index ${index}: ${why}`));
      }
    }
  } catch (error) {
    // Reading the array itself failed: the listeners still hear that something changed.
    note(error);
  }
  return changes.length ? Object.freeze(changes) : NO_CHANGES;
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
  const listeners = new Set<(changes: readonly AgentChange[]) => void>();
  let cached: readonly AgentEntry[] | undefined;
  // The end of the last queued call: calls run one at a time, in the order they were made.
  let queue: Promise<unknown> = Promise.resolve();

  function changed(changes: readonly AgentChange[] = NO_CHANGES): void {
    cached = undefined;
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try { listener(changes); } catch (error) { report(error); }
    }
  }

  const connect: Agent['connect'] = (component) => {
    validate(component, connections);
    const { name } = component;
    let connection: Connection | undefined;
    const unsubscribe = component.subscribe((changes) => {
      // A late call from a component that was already disconnected changes nothing.
      if (connection && connections.get(name) === connection) changed(readChanges(name, changes));
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
    const own = (changes: readonly AgentChange[]): void => { listener(changes); };
    listeners.add(own);
    return () => { listeners.delete(own); };
  };

  // Each component's own snapshot, read now: a step never trusts a cached list. `members` are the
  // connections a call may find its records in.
  const environmentOf = (members: () => readonly Connection[]): ActEnvironment => ({
    locate: (ref) => {
      for (const connection of members()) {
        const entry = connection.component.snapshot().find((record) => record.ref === ref);
        if (entry) {
          const { name } = connection.component;
          return { found: true, component: connection.component, entry, live: () => connections.get(name) === connection } satisfies Located;
        }
      }
      return { found: false };
    },
    // Only words for a message, from every component there is now: one that breaks is left out.
    refs: () => [...connections.values()].flatMap(({ component }) => {
      try { return component.snapshot().map((record) => record.ref); } catch { return []; }
    }),
    allow,
    timeout,
    report: note,
  });

  const act: Agent['act'] = (input, actOptions) => {
    let call: ReturnType<typeof parseCall>;
    // A getter on the input may throw: that is an invalid call, not a rejection.
    try { call = parseCall(input, actOptions); } catch { return Promise.resolve(failed(0, 'Invalid call: its input could not be read. No step ran.')); }
    if (!('steps' in call)) return Promise.resolve(failed(call.step, call.message));
    const { steps, signal } = call;
    // The components this call could have read its refs from. One connected later may hand out the
    // same ref for another record (a recreated adapter counts from one again), so the call does not see it.
    const known = new Set(connections.values());
    const own = environmentOf(() => [...connections.values()].filter((connection) => known.has(connection)));
    const first = steps[0]!;
    const unusable = failed(0, 'Invalid call: options.signal could not be used. No step ran.');
    // A signal is checked by shape only, so reading it or listening to it may throw.
    try { if (signal?.aborted) return Promise.resolve(failed(0, cancelledBefore(first))); } catch { return Promise.resolve(unusable); }
    return new Promise<ActResult>((resolve) => {
      let started = false;
      // Cancelled while it waits for its turn: answer now; its turn then finds the signal aborted.
      const cancel = (): void => { if (!started) resolve(failed(0, cancelledBefore(first))); };
      try { signal?.addEventListener('abort', cancel, { once: true }); } catch { resolve(unusable); return; }
      const turn = queue.then(() => {
        started = true;
        signal?.removeEventListener('abort', cancel);
        return runSteps(steps, signal, own);
      }).catch((error: unknown) => {
        // Unreachable unless the bridge itself is broken; the call still settles.
        note(error);
        return failed(0, 'The agent bridge failed. No further step ran.');
      });
      queue = turn;
      void turn.then(resolve);
    });
  };

  return Object.freeze({ connect, snapshot, subscribe, act });
}
