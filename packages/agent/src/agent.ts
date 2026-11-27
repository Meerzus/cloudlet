import { cancelledBefore, cloneValue, failed, parseCall, runSteps, type ActEnvironment, type Located } from './act.js';
import { ACT, SNAPSHOT, TOOLS } from './tools.js';
import type {
  ActResult, Agent, AgentActToolResult, AgentCallTool, AgentChange, AgentComponent, AgentEntry, AgentOptions, AgentSnapshotToolResult,
  AgentToolError, AgentToolResult, AgentValue, AgentVerbs,
} from './types.js';
import { collectVerbs, readVerbs, registerVerbs } from './verbs.js';

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
    // Read once: a getter of a record could grow the array while it is being walked.
    const count = input.length;
    if (count > MOST_CHANGES) throw new TypeError(`Component "${name}" reported more than ${MOST_CHANGES} changes at once`);
    for (let index = 0; index < count; index += 1) {
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

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function toolError(message: string): AgentToolError {
  return Object.freeze({ ok: false as const, error: Object.freeze({ message }) });
}

/** Names a value a model sent in a message, without running any of its code. */
function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || value === undefined) return String(value);
  return Array.isArray(value) ? 'a list' : `a value of type ${typeof value}`;
}

/**
 * The records as plain data, so a tool's answer reads the same through JSON and `structuredClone`.
 * A key whose value is not plain data (a component's mistake) is left out and reported.
 */
function plainEntries(entries: readonly AgentEntry[]): readonly AgentEntry[] {
  return Object.freeze(entries.map((entry) => {
    const pairs: [string, AgentValue][] = [];
    for (const key of Object.keys(entry)) {
      const value: unknown = entry[key];
      if (value === undefined) continue;
      try { pairs.push([key, cloneValue(value)]); } catch { note(new TypeError(`Record "${entry.ref}" has a key "${key}" that is not plain data`)); }
    }
    // `fromEntries` defines own properties, so a key named `__proto__` stays a key.
    return Object.freeze(Object.fromEntries(pairs)) as AgentEntry;
  }));
}

interface Connection {
  readonly component: AgentComponent;
  readonly unsubscribe: () => void;
  /** The component's `verbs` as it was when it connected. */
  readonly verbs: AgentVerbs | undefined;
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
    const verbs = readVerbs(name, component.verbs);
    let connection: Connection | undefined;
    const unsubscribe = component.subscribe((changes) => {
      // A late call from a component that was already disconnected changes nothing.
      if (connection && connections.get(name) === connection) changed(readChanges(name, changes));
    });
    connection = { component, unsubscribe, verbs };
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

  /**
   * Queues a call. `watch` hears when the call's turn starts and when its steps have answered. An
   * invalid call never gets a turn; one cancelled while it waited has already answered when its turn
   * comes, and its watch still hears both then.
   */
  const perform = (input: unknown, actOptions: unknown, watch?: { readonly start: () => void; readonly stop: () => void }): Promise<ActResult> => {
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
      const turn = queue.then(async () => {
        started = true;
        signal?.removeEventListener('abort', cancel);
        watch?.start();
        try { return await runSteps(steps, signal, own); } finally { watch?.stop(); }
      }).catch((error: unknown) => {
        // Unreachable unless the bridge itself is broken; the call still settles.
        note(error);
        return failed(0, 'The agent bridge failed. No further step ran.');
      });
      queue = turn;
      void turn.then(resolve);
    });
  };

  const act: Agent['act'] = (input, actOptions) => perform(input, actOptions);

  /** The verbs of the kinds of record in the snapshot now, for the tools. */
  const verbs = (): AgentVerbs => collectVerbs(snapshot(), [...connections.values()].map((connection) => connection.verbs));

  /** `cloudlet_snapshot`: the records as plain data, and the verbs of their kinds. */
  const snapshotTool = (input: unknown): AgentSnapshotToolResult | AgentToolError => {
    if (input !== undefined) {
      const keys = isObject(input) ? Object.keys(input) : undefined;
      if (keys?.length !== 0) {
        const got = keys ? `the key ${JSON.stringify(keys[0])}` : describe(input);
        return toolError(`${SNAPSHOT} takes no input: send {}. It got ${got}.`);
      }
    }
    let entries: readonly AgentEntry[];
    try { entries = snapshot(); } catch (error) {
      note(error);
      return toolError(`${SNAPSHOT} failed: a component could not give its records. Try again later.`);
    }
    return Object.freeze({ entries: plainEntries(entries), verbs: verbs() });
  };

  /** `cloudlet_act`: the result of the call and the changes heard while it ran, and only then. */
  const actTool = async (input: unknown, options: unknown): Promise<AgentActToolResult> => {
    const changes: AgentChange[] = [];
    let answered = false;
    let stop: (() => void) | undefined;
    const result = await perform(input, options, {
      // A call cancelled while it waited answers before its turn comes: it listens to nothing then.
      start: () => { if (!answered) stop = subscribe((heard) => { if (!answered) changes.push(...heard); }); },
      stop: () => { stop?.(); stop = undefined; },
    });
    answered = true;
    stop?.();
    stop = undefined;
    return Object.freeze({ ...result, changes: changes.length ? Object.freeze(changes) : NO_CHANGES });
  };

  const callTool = ((name: unknown, input?: unknown, options?: unknown): Promise<AgentToolResult> => {
    try {
      if (name === ACT) return actTool(input, options);
      if (name === SNAPSHOT) return Promise.resolve(snapshotTool(input));
      return Promise.resolve(toolError(`Unknown tool ${describe(name)}. Tools: ${TOOLS.map((tool) => tool.name).join(', ')}.`));
    } catch (error) {
      // Unreachable unless the bridge itself is broken (a getter on the input that throws is read inside
      // the act's own guard); the call still answers.
      note(error);
      return Promise.resolve(toolError('The agent bridge failed. Nothing ran.'));
    }
  }) as AgentCallTool;

  const agent: Agent = Object.freeze({ connect, snapshot, subscribe, act, tools: TOOLS, callTool });
  registerVerbs(agent, verbs);
  return agent;
}
