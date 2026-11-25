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
 * What a component hands to {@link Agent.connect}: its name, its records and a way to hear that
 * they changed. A component's adapter builds this object; the agent never reaches into the
 * component itself.
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
}

/**
 * The kit's bridge: one snapshot over every connected component.
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
   * @throws TypeError for an unknown `protocol`, a name outside `[a-z][a-z0-9-]*`, or a name
   * that is already connected.
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
}
