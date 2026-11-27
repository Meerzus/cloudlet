import type { Agent, AgentEntry, AgentVerbs } from './types.js';

const NO_VERBS: AgentVerbs = Object.freeze({});
const isObject = (value: unknown): value is object => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Reads a component's `verbs` once, checks its shape and copies it frozen, so the agent keeps what
 * the component said at connection whatever happens to the object later. `Object.fromEntries` makes
 * own keys, so a kind or verb named `__proto__` stays a key.
 *
 * @throws TypeError for anything but an object of objects of non-empty strings.
 */
export function readVerbs(name: string, input: unknown): AgentVerbs | undefined {
  if (input === undefined) return undefined;
  const wrong = (what: string) => new TypeError(`Component "${name}": ${what}`);
  if (!isObject(input)) throw wrong('verbs must be an object of verb descriptions by kind of record');
  return Object.freeze(Object.fromEntries(Object.keys(input).map((kind) => {
    const verbs: unknown = (input as Record<string, unknown>)[kind];
    if (!kind) throw wrong('a kind of record in verbs must not be empty');
    if (!isObject(verbs)) throw wrong(`verbs of "${kind}" must be an object of descriptions by verb`);
    return [kind, Object.freeze(Object.fromEntries(Object.keys(verbs).map((verb) => {
      const text: unknown = (verbs as Record<string, unknown>)[verb];
      if (!verb) throw wrong(`a verb of "${kind}" must not be empty`);
      if (typeof text !== 'string' || !text.trim()) throw wrong(`the description of "${verb}" on "${kind}" must be a non-empty string`);
      return [verb, text];
    })))];
  })));
}

/**
 * The verbs of every kind of record that `entries` hold, once per kind, in the order the kinds first
 * appear. Each kind's description comes from the first component, in connection order, that
 * describes it (two Toasters describe `notification` alike); a kind nobody describes is left out.
 */
export function collectVerbs(entries: readonly AgentEntry[], described: Iterable<AgentVerbs | undefined>): AgentVerbs {
  const sources = [...described].filter((verbs) => verbs !== undefined);
  const kinds: [string, AgentVerbs[string]][] = [];
  const seen = new Set<string>();
  for (const { component } of entries) {
    if (seen.has(component)) continue;
    seen.add(component);
    const source = sources.find((verbs) => Object.hasOwn(verbs, component));
    if (source) kinds.push([component, source[component]!]);
  }
  return kinds.length ? Object.freeze(Object.fromEntries(kinds)) : NO_VERBS;
}

// Each agent's way to describe the verbs of its current snapshot. Not public: the tools read it
// inside the agent, tests through `verbsOf`.
const describers = new WeakMap<Agent, () => AgentVerbs>();

/** Remembers how `agent` describes the verbs of its snapshot. */
export function registerVerbs(agent: Agent, describe: () => AgentVerbs): void {
  describers.set(agent, describe);
}

/** The verbs of the kinds of record in `agent.snapshot()` now; empty for an object no agent made. */
export function verbsOf(agent: Agent): AgentVerbs {
  return describers.get(agent)?.() ?? NO_VERBS;
}
