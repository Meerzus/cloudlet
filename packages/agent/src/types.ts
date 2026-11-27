/**
 * One record of a snapshot: a thing a component shows, addressed by `ref`.
 *
 * `ref`, `component` and `actions` are always present; every other key is state the component
 * chose to describe (a label, a count, whether something is open).
 *
 * @experimental The protocol may change in any 0.x release.
 */
export interface AgentEntry {
  /** Stable address of this record, unique across the agent (`toaster`, `toaster:3`). */
  readonly ref: string;
  /** What kind of thing this record describes (`toaster`, `notification`). */
  readonly component: string;
  /** Verbs that apply to this record in its current state. */
  readonly actions: readonly string[];
  readonly [key: string]: unknown;
}

/**
 * A cancellation signal as the bridge reads it. The platform's `AbortSignal` fits; the signals the
 * bridge hands to `allow` and to a component are `AbortSignal`s at runtime.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export interface AgentSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  readonly throwIfAborted: () => void;
  readonly addEventListener: (type: 'abort', listener: () => void, options?: { readonly once?: boolean }) => void;
  readonly removeEventListener: (type: 'abort', listener: () => void) => void;
}

/**
 * Plain data, in a step's `args` and in what a step returns: what survives `structuredClone` and
 * JSON alike. Numbers are finite: `NaN` and the infinities are not plain data. A call whose `args`
 * hold anything else is invalid; a result that does is left out of the step's record.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export type AgentValue = string | number | boolean | null | readonly AgentValue[] | { readonly [key: string]: AgentValue };

/**
 * One change a component reports to {@link Agent.subscribe}: what changed on which record and who
 * changed it. Each component documents its own keys and what their values mean.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export interface AgentChange {
  /** The record that changed, as its `ref` in the snapshot. */
  readonly ref: string;
  /** What kind of thing the record describes, as in its snapshot record. */
  readonly component: string;
  /**
   * How a person names the record (a notification's title). A record that was removed is no longer
   * in the snapshot, so its `ref` alone would say nothing.
   */
  readonly label?: string;
  /** What changed on the record (`present`, `action`, `island`). */
  readonly key: string;
  /** The value after the change. */
  readonly value: AgentValue;
  /** The value before it. */
  readonly previous: AgentValue;
  /** Why, when the component has a word for it (why a notification closed). */
  readonly reason?: string;
  /**
   * Who made the change: a person through the component on screen, an agent through
   * {@link Agent.act}, the app's own code, or the component itself (a timer, an outcome).
   */
  readonly source: 'user' | 'agent' | 'app' | 'system';
}

/**
 * What a step may do without anyone's say, with a person's (or the app's) approval, or never.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export type AgentPermission = 'allow' | 'confirm' | 'deny';

/**
 * One step of an {@link Agent.act} call: a verb from a record's `actions`, addressed by its `ref`.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export interface AgentStep {
  readonly ref: string;
  readonly action: string;
  /** The verb's arguments, if it takes any (`fill` takes a field name and a value). */
  readonly args?: readonly unknown[];
}

/**
 * The argument of {@link Agent.act}. No other keys are accepted.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export interface ActInput {
  /** At least one step; they run in order and stop at the first error. */
  readonly steps: readonly AgentStep[];
}

/** @experimental The protocol may change in any 0.x release. */
export interface ActOptions {
  /** Cancels the call: a step that is waiting for `allow` or for the component stops waiting. */
  readonly signal?: AgentSignal;
}

/**
 * A step done, in the order it ran. `step` is its index in `steps`, from zero.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export interface ActStepResult {
  readonly step: number;
  readonly ref: string;
  /** What the component reported, or `pending` when it was still working at the timeout. */
  readonly result?: AgentValue;
  /** The step removed its record from the snapshot. */
  readonly gone?: true;
}

/**
 * What {@link Agent.act} resolves to: frozen, and safe for `structuredClone` and JSON. A failed call
 * keeps the steps that ran before the error; there is no rollback.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export type ActResult =
  | { readonly ok: true; readonly steps: readonly ActStepResult[] }
  | {
    readonly ok: false;
    /** The step that failed, from zero, and a message written for the agent. */
    readonly error: { readonly step: number; readonly message: string };
    readonly steps: readonly ActStepResult[];
  };

/**
 * A step as `allow` sees it. `needsPerson` is true when the component asks for a person's
 * approval: return `true` only if the person (or the app on their behalf) approved it.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export interface AllowStep {
  readonly ref: string;
  readonly action: string;
  readonly args: readonly unknown[];
  readonly needsPerson: boolean;
}

/**
 * The app's say on each step that a component did not deny. Only `true` approves; `false`, any
 * other value, a throw, a rejection and no answer within the timeout all refuse. `signal` aborts
 * when the call is cancelled or the timeout elapses, so a pending question can be withdrawn.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export type Allow = (step: AllowStep, context: { readonly signal: AgentSignal }) => boolean | PromiseLike<boolean>;

/** @experimental The protocol may change in any 0.x release. */
export interface AgentOptions {
  /** Asked before every step a component did not deny. Without it, `confirm` steps need a person. */
  readonly allow?: Allow;
  /**
   * How long a step waits for `allow`, and then for the component, in milliseconds. A finite
   * positive number; default 300 000 (five minutes).
   */
  readonly timeout?: number;
}

/**
 * A step as the bridge hands it to a component, with `args` always present.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export interface AgentStepCall {
  readonly ref: string;
  readonly action: string;
  readonly args: readonly unknown[];
}

/**
 * How a person names what a step acts on, for the bridge's messages: `target` is what is pressed
 * (an action's label), `within` the thing it belongs to (a notification's title).
 *
 * @experimental The protocol may change in any 0.x release.
 */
export interface AgentStepNames {
  readonly target: string;
  readonly within?: string;
}

/**
 * A component's answer to {@link AgentComponent.check}. An unavailable step without `message` gets
 * the bridge's text, which lists the record's current `actions`.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export type AgentStepCheck =
  | { readonly available: true; readonly permission: AgentPermission; readonly names?: AgentStepNames }
  | { readonly available: false; readonly message?: string };

/**
 * What {@link AgentComponent.run} receives besides the step.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export interface AgentRunContext {
  /** Aborts when the call is cancelled or the timeout elapses; the bridge stops waiting then. */
  readonly signal: AgentSignal;
  /**
   * The permission the bridge cleared. If the step now needs more (`confirm` after `allow`, or
   * `deny`), the component must not run it and answers `stale`.
   */
  readonly approved: 'allow' | 'confirm';
}

/**
 * A component's answer to {@link AgentComponent.run}:
 * - `done`: the step ran; `result` and `gone` reach the agent as they are;
 * - `failed`: the step ran and failed; `message` is the error the agent reads;
 * - `unavailable`: the step can no longer run and nothing happened, as in a check;
 * - `stale`: the step now needs more permission than was cleared, and nothing happened.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export type AgentRunOutcome =
  | { readonly status: 'done'; readonly result?: AgentValue; readonly gone?: boolean }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'unavailable'; readonly message?: string }
  | { readonly status: 'stale' };

/**
 * A component's answer to {@link AgentComponent.summon}. `true` or `false`: the step is or is not
 * in front of the person now, and the bridge says so in its own words. An object lets the component
 * say where the person finds it: `note` is one sentence that replaces the bridge's, and `reached`
 * says whether the person sees the step now or will without anyone's help, in which case the agent
 * is told to ask them to take it.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export type AgentSummonOutcome = boolean | { readonly reached: boolean; readonly note: string };

/**
 * What a component's verbs do, for an agent that has never seen its code: by kind of record (the
 * `component` of its snapshot records), each verb with a line or two on its arguments in order,
 * what it does and when it needs a person.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export interface AgentVerbs {
  readonly [component: string]: { readonly [verb: string]: string };
}

/**
 * What a component hands to {@link Agent.connect}: its name, its records and a way to hear that
 * they changed. A component's adapter builds this object; the agent never reaches into the
 * component itself.
 *
 * A component that takes steps adds `check` and `run` together. `summon` is optional on top of them:
 * a component whose steps can need a person adds it to bring such a step in front of them, and
 * without it the agent is told the step is not on screen. A read-only component leaves all three out.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export interface AgentComponent {
  /** Protocol version this object speaks. The agent rejects any other value. */
  readonly protocol: 1;
  /** Unique among connected components; matches `[a-z][a-z0-9-]*`. */
  readonly name: string;
  /** The component's current records, in the order a reader should see them. */
  snapshot(): readonly AgentEntry[];
  /**
   * Calls `listener` whenever `snapshot()` may return something new; returns the unsubscribe. A
   * component that knows what changed and who changed it passes the records; calling the listener
   * without an argument stays correct.
   */
  subscribe(listener: (changes?: readonly AgentChange[]) => void): () => void;
  /**
   * Says, synchronously and without side effects, whether `step` can run now and under which
   * permission. Called with a `ref` from this component's own snapshot.
   */
  readonly check?: (step: AgentStepCall) => AgentStepCheck;
  /**
   * Runs a step that `check` cleared and the app approved. State may have changed while the step
   * waited, so it checks availability and permission again itself before doing anything.
   */
  readonly run?: (step: AgentStepCall, context: AgentRunContext) => AgentRunOutcome | PromiseLike<AgentRunOutcome>;
  /**
   * Brings a `confirm` step that nobody approved in front of a person, without moving focus, and
   * says where they find it. Optional even for a component with `confirm` steps: without it the
   * agent is told the step is not on screen and should tell the person what it does.
   */
  readonly summon?: (step: AgentStepCall) => AgentSummonOutcome;
  /**
   * What the verbs of this component's records do, by kind of record. The agent copies it when the
   * component connects; a later change to the object is not seen.
   */
  readonly verbs?: AgentVerbs;
}

/**
 * The name of one of the bridge's tools.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export type AgentToolName = 'cloudlet_act' | 'cloudlet_snapshot';

/**
 * A tool as model SDKs and WebMCP describe one: its name, a text on when and how to call it, and the
 * JSON Schema of its input. Plain data, frozen.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export interface AgentTool {
  readonly name: AgentToolName;
  readonly description: string;
  readonly inputSchema: { readonly [key: string]: AgentValue };
}

/**
 * What `cloudlet_snapshot` answers: the records of {@link Agent.snapshot} and what the verbs of their
 * kinds do, once per kind present.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export interface AgentSnapshotToolResult {
  readonly entries: readonly AgentEntry[];
  readonly verbs: AgentVerbs;
}

/**
 * What `cloudlet_act` answers: the call's {@link ActResult} and every change {@link Agent.subscribe}
 * heard from the moment the call started running (after the calls queued before it) until it
 * answered, whoever made it. An invalid call ran nothing and has no changes.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export type AgentActToolResult = ActResult & { readonly changes: readonly AgentChange[] };

/**
 * What a tool answers when it could not run: an unknown name, input `cloudlet_snapshot` does not
 * take, or a snapshot a component failed to give.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export interface AgentToolError {
  readonly ok: false;
  readonly error: { readonly message: string };
}

/**
 * Anything {@link Agent.callTool} answers. Plain data: `JSON.stringify` and `structuredClone` keep
 * the same values.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export type AgentToolResult = AgentSnapshotToolResult | AgentActToolResult | AgentToolError;

/**
 * Runs one of the bridge's tools by name, the way a model calls it.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export interface AgentCallTool {
  (name: 'cloudlet_snapshot', input?: unknown, options?: ActOptions): Promise<AgentSnapshotToolResult | AgentToolError>;
  (name: 'cloudlet_act', input: unknown, options?: ActOptions): Promise<AgentActToolResult>;
  (name: string, input?: unknown, options?: ActOptions): Promise<AgentToolResult>;
}

/**
 * The kit's bridge: one snapshot over every connected component, and steps through them.
 *
 * Its functions are bound, so `useSyncExternalStore(agent.subscribe, agent.snapshot)` works as is.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export interface Agent {
  /**
   * Adds a component's records to the snapshot and returns the function that removes them.
   * Calling that function again does nothing.
   *
   * @throws TypeError for an unknown `protocol`, a name outside `[a-z][a-z0-9-]*`, a name that is
   * already connected, step methods that are not functions or come without each other, or `verbs`
   * that is not an object of objects of strings.
   */
  readonly connect: (component: AgentComponent) => () => void;
  /**
   * Records of every connected component, in connection order, as one frozen array. The same
   * array comes back until a component reports a change or one is connected or disconnected.
   */
  readonly snapshot: () => readonly AgentEntry[];
  /**
   * Calls `listener` when a connected component changes and when a component is connected or
   * disconnected; returns the unsubscribe. The listener receives what the component said about the
   * change as a frozen array of {@link AgentChange} records: empty when it said nothing, or when
   * the snapshot changed with no author (time passing, a connection). A listener that takes no
   * argument fits as before. Every listener runs even if one throws; the error is rethrown in a
   * microtask, so it reaches the runtime's uncaught-error handling.
   */
  readonly subscribe: (listener: (changes: readonly AgentChange[]) => void) => () => void;
  /**
   * Runs steps in order and stops at the first error; steps already done stay done. Calls of one
   * agent run one at a time, so a call made while a step waits for `allow` waits too. The whole
   * input is checked before the first step. The promise never rejects: every failure is an
   * `error` in the result, with a message written for the agent. What `allow` or a component
   * threw is not thrown again: a page gets it through `reportError`, any other runtime in
   * `console.error`.
   */
  readonly act: (input: ActInput, options?: ActOptions) => Promise<ActResult>;
  /**
   * The bridge's tools for a model, `cloudlet_act` and `cloudlet_snapshot`, as
   * `{ name, description, inputSchema }`: the same frozen array for every agent, whatever is
   * connected. What each component's verbs do comes in the snapshot's `verbs`.
   */
  readonly tools: readonly AgentTool[];
  /**
   * Runs a tool by name with the input a model sent, and answers plain data. `cloudlet_snapshot`
   * takes `{}` (or nothing) and answers `{ entries, verbs }`. `cloudlet_act` takes what
   * {@link Agent.act} takes, waits in the same queue, and answers its result with the `changes`
   * heard while the call ran; `signal` cancels it as it cancels `act`. An unknown name or input
   * `cloudlet_snapshot` does not take answer `{ ok: false, error: { message } }`. The promise
   * never rejects.
   */
  readonly callTool: AgentCallTool;
}
