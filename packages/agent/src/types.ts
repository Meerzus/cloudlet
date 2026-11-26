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
 * A value a step may return: what survives `structuredClone` and JSON alike.
 *
 * @experimental The protocol may change in any 0.x release.
 */
export type AgentValue = string | number | boolean | null | readonly AgentValue[] | { readonly [key: string]: AgentValue };

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
 * What a component hands to {@link Agent.connect}: its name, its records and a way to hear that
 * they changed. A component's adapter builds this object; the agent never reaches into the
 * component itself.
 *
 * A component that takes steps adds `check` and `run` together, and `summon` if any of its steps
 * can need a person. A read-only component leaves all three out.
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
  /** Calls `listener` whenever `snapshot()` may return something new; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
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
   * says where they find it.
   */
  readonly summon?: (step: AgentStepCall) => AgentSummonOutcome;
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
   * already connected, or step methods that are not functions or come without each other.
   */
  readonly connect: (component: AgentComponent) => () => void;
  /**
   * Records of every connected component, in connection order, as one frozen array. The same
   * array comes back until a component reports a change or one is connected or disconnected.
   */
  readonly snapshot: () => readonly AgentEntry[];
  /**
   * Calls `listener` when a connected component changes and when a component is connected or
   * disconnected; returns the unsubscribe. Every listener runs even if one throws; the error is
   * rethrown in a microtask, so it reaches the runtime's uncaught-error handling.
   */
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Runs steps in order and stops at the first error; steps already done stay done. Calls of one
   * agent run one at a time, so a call made while a step waits for `allow` waits too. The whole
   * input is checked before the first step. The promise never rejects: every failure is an
   * `error` in the result, with a message written for the agent.
   */
  readonly act: (input: ActInput, options?: ActOptions) => Promise<ActResult>;
}
