import type {
  ActResult, ActStepResult, AgentComponent, AgentEntry, AgentRunOutcome, AgentSignal, AgentStepCall,
  AgentStepCheck, AgentStepNames, AgentValue, Allow, AllowStep,
} from './types.js';
import { MOST_STEPS } from './tools.js';

// The runtimes the kit supports all have these; the package is typed without DOM or Node globals.
declare function setTimeout(callback: () => void, ms: number): unknown;
declare function clearTimeout(handle: unknown): void;
declare const AbortController: new () => { readonly signal: AgentSignal; abort(reason?: unknown): void };

const freeze = Object.freeze;
const NO_ARGS: readonly unknown[] = freeze([]);
const STEP_KEYS = new Set(['ref', 'action', 'args']);

/** Where a ref lives right now, or every ref there is when it lives nowhere. */
export type Located =
  | { readonly found: true; readonly component: AgentComponent; readonly entry: AgentEntry; readonly live: () => boolean }
  | { readonly found: false };

export interface ActEnvironment {
  readonly locate: (ref: string) => Located;
  readonly refs: () => readonly string[];
  readonly allow: Allow | undefined;
  readonly timeout: number;
  readonly report: (error: unknown) => void;
}

type Failure = { readonly step: number; readonly message: string };

export function failed(step: number, message: string, done: readonly ActStepResult[] = []): ActResult {
  // Steps stop at the first error, so the ones done are exactly those before it.
  const count = done.length;
  const tail = count === 1 ? ' Step 0 stayed done.' : count > 1 ? ` Steps 0–${count - 1} stayed done.` : '';
  return freeze({ ok: false as const, error: freeze({ step, message: message + tail }), steps: freeze([...done]) });
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export function isSignal(value: unknown): value is AgentSignal {
  return value !== null && typeof value === 'object' && typeof (value as AgentSignal).aborted === 'boolean'
    && typeof (value as AgentSignal).addEventListener === 'function'
    && typeof (value as AgentSignal).removeEventListener === 'function';
}

const SHAPE = '{"steps": [{"ref": "<ref>", "action": "<verb>"}]}';
const ARGS = 'arguments go in "args" as a list, like "args": ["<first>", "<second>"]';

/**
 * Checks the whole call before anything runs, and copies what it reads once. Each message says what
 * to change, for a model that sends the call again without a person's help.
 */
export function parseCall(input: unknown, options: unknown): {
  readonly steps: readonly AgentStepCall[];
  readonly signal: AgentSignal | undefined;
  readonly allow: Allow | undefined;
} | Failure {
  const invalid = (step: number, problem: string): Failure => ({ step, message: `Invalid call: ${problem}. No step ran.` });
  if (Array.isArray(input)) return invalid(0, `expected an object with steps, not a bare list: ${SHAPE}`);
  if (!isObject(input)) return invalid(0, `expected an object with steps: ${SHAPE}`);
  if (!Object.hasOwn(input, 'steps') && (Object.hasOwn(input, 'ref') || Object.hasOwn(input, 'action'))) {
    return invalid(0, `a step came on its own; steps go in a list under "steps", even a single one: ${SHAPE}`);
  }
  for (const key of Object.keys(input)) if (key !== 'steps') return invalid(0, `unknown key ${JSON.stringify(key)}; the call takes only "steps": ${SHAPE}`);
  const raw = input.steps;
  if (isObject(raw)) return invalid(0, `steps must be a list, even for a single step: ${SHAPE}`);
  if (!Array.isArray(raw) || raw.length === 0) return invalid(0, `steps must be a non-empty list: ${SHAPE}`);
  if (raw.length > MOST_STEPS) {
    return invalid(0, `${raw.length} steps is more than ${MOST_STEPS} in one call; split them into calls of at most ${MOST_STEPS} steps`);
  }
  const steps: AgentStepCall[] = [];
  for (let index = 0; index < raw.length; index++) {
    // A hole would read whatever the prototype holds at that index.
    const step: unknown = Object.hasOwn(raw, index) ? raw[index] : undefined;
    const at = `steps[${index}]`;
    if (!isObject(step)) return invalid(index, `${at} must be an object like {"ref": "<ref>", "action": "<verb>"}`);
    for (const key of Object.keys(step)) {
      if (key === 'value') return invalid(index, `${at} has "value", which a step doesn't take: ${ARGS}`);
      if (!STEP_KEYS.has(key)) return invalid(index, `${at} has an unknown key ${JSON.stringify(key)}; a step takes only "ref", "action" and "args"`);
    }
    const { ref, action, args } = step;
    if (ref === undefined) return invalid(index, `${at} has no "ref"; give it a ref from cloudlet_snapshot`);
    if (typeof ref !== 'string') return invalid(index, `${at}.ref must be a string: a ref from cloudlet_snapshot`);
    if (action === undefined) return invalid(index, `${at} has no "action"; give it a verb from the record's actions`);
    if (typeof action !== 'string') return invalid(index, `${at}.action must be a string: a verb from the record's actions`);
    if (args !== undefined && !Array.isArray(args)) return invalid(index, `${at}.args is not a list: ${ARGS}`);
    // A deep frozen copy: what `allow` is asked about is what runs, whatever the caller does to its own objects meanwhile.
    let copied = NO_ARGS;
    if (args !== undefined) {
      try { copied = cloneValue(args) as readonly unknown[]; } catch {
        return invalid(index, `${at}.args must hold plain data: strings, finite numbers, booleans, null, lists and plain objects`);
      }
    }
    steps.push(freeze({ ref, action, args: copied }));
  }
  if (options !== undefined && !isObject(options)) return invalid(0, 'options must be an object');
  const signal = options?.signal;
  if (signal !== undefined && !isSignal(signal)) return invalid(0, 'options.signal must be an AbortSignal');
  const allow = options?.allow;
  if (allow !== undefined && typeof allow !== 'function') return invalid(0, 'options.allow must be a function');
  return { steps: freeze(steps), signal, allow: allow as Allow | undefined };
}

type Settled<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'cancelled' };

function timeoutReason(): Error {
  const error = new Error('The agent step timed out');
  error.name = 'TimeoutError';
  return error;
}

/**
 * Starts `work` with a signal of its own and waits for it, the caller's cancellation or the
 * timeout, whichever comes first. A synchronous answer starts no timer. Whatever settles later is
 * dropped, so an answer that arrives after the timeout or the cancellation starts nothing.
 */
function wait<T>(work: (signal: AgentSignal) => T | PromiseLike<T>, outer: AgentSignal | undefined, timeout: number): Settled<T> | Promise<Settled<T>> {
  const controller = new AbortController();
  let answer: T | PromiseLike<T>;
  // `then` is read once, here: a getter may answer differently, or throw, the second time.
  let then: unknown;
  try {
    answer = work(controller.signal);
    if ((typeof answer === 'object' || typeof answer === 'function') && answer !== null) then = (answer as PromiseLike<T>).then;
  } catch (error) { return { kind: 'error', error }; }
  if (typeof then !== 'function') return { kind: 'value', value: answer as T };
  const pending = answer;
  const subscribe = then as PromiseLike<T>['then'];
  return new Promise<Settled<T>>((resolve) => {
    let settled = false;
    const settle = (result: Settled<T>, reason?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      outer?.removeEventListener('abort', cancel);
      if (result.kind === 'timeout' || result.kind === 'cancelled') controller.abort(reason);
      resolve(result);
    };
    const cancel = (): void => { settle({ kind: 'cancelled' }, outer?.reason); };
    const timer = setTimeout(() => { settle({ kind: 'timeout' }, timeoutReason()); }, timeout);
    outer?.addEventListener('abort', cancel, { once: true });
    if (outer?.aborted) cancel();
    new Promise<T>((fulfil, refuse) => { subscribe.call(pending, fulfil, refuse); }).then(
      (value) => { settle({ kind: 'value', value }); },
      (error: unknown) => { settle({ kind: 'error', error }); },
    );
  });
}

/** Copies a value a component produced as plain data, frozen and cloneable; throws for anything else. */
export function cloneValue(value: unknown): AgentValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  // JSON turns NaN and the infinities into null, so they are not plain data here.
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    // A fresh array filled by index: the input's own `map` could hand back anything.
    const copy: AgentValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      // A hole would read whatever the prototype holds at that index.
      if (!Object.hasOwn(value, index)) throw new TypeError('Expected plain data: an array with a hole');
      copy.push(cloneValue(value[index]));
    }
    return freeze(copy);
  }
  if (typeof value === 'object') {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      // `fromEntries` defines own properties, so a key named `__proto__` stays a key.
      return freeze(Object.fromEntries(Object.keys(value).map((key) => [key, cloneValue((value as Record<string, unknown>)[key])])));
    }
  }
  throw new TypeError(`Expected plain data: ${typeof value === 'number' ? String(value) : Object.prototype.toString.call(value)}`);
}

const quote = JSON.stringify;
const on = (step: AgentStepCall): string => `${quote(step.action)} on ${quote(step.ref)}`;

const texts = {
  noEntry: (ref: string, refs: readonly string[]) => `No entry ${quote(ref)}. Current refs: ${refs.length ? refs.join(', ') : 'none'}.`,
  noSteps: (step: AgentStepCall) => `${quote(step.action)} is not available on ${quote(step.ref)}: its component takes no steps.`,
  unavailable: (step: AgentStepCall, actions: readonly string[]) =>
    `${quote(step.action)} is not available on ${quote(step.ref)} now. Available: ${actions.length ? actions.join(', ') : 'none'}.`,
  denied: (step: AgentStepCall, names: AgentStepNames | undefined) =>
    `Not allowed: the app does not let an agent ${names ? `${step.action} ${quote(names.target)}${names.within === undefined ? '' : ` on ${quote(names.within)}`}` : `run ${on(step)}`}. Look for no other way.`,
  saidNo: (step: AgentStepCall) => `The app said no to ${on(step)}.`,
  noAnswer: (step: AgentStepCall) => `The app did not answer about ${on(step)} in time, so it did not run.`,
  needsPerson: (step: AgentStepCall, names: AgentStepNames | undefined, reached: boolean, note: string | undefined) => {
    const what = names ? `${quote(names.target)}${names.within === undefined ? '' : ` on ${quote(names.within)}`}` : on(step);
    return reached
      ? `Needs a person: ${what}. ${note ?? 'It is on screen in front of them now.'} Ask them to ${step.action} ${names ? quote(names.target) : 'it'} themselves.`
      : `Needs a person: ${what}. ${note ?? 'It is not on screen, so tell them what it does.'}`;
  },
  cancelledBefore: (step: AgentStepCall) => `Cancelled before ${on(step)} ran.`,
  cancelledDuring: (step: AgentStepCall) => `Cancelled while ${on(step)} was running. It may still finish.`,
  stale: (step: AgentStepCall) => `${on(step)} changed while it waited, so it did not run. Read the snapshot and try again.`,
  broken: (step: AgentStepCall) => `${on(step)} failed inside its component.`,
};

export function cancelledBefore(step: AgentStepCall): string {
  return texts.cancelledBefore(step);
}

/** What one call brings besides its steps: its cancellation and its own gate. */
export interface CallContext {
  readonly signal: AgentSignal | undefined;
  /** The call's `allow`, asked after the agent's: it can only narrow what the agent's gate lets through. */
  readonly allow: Allow | undefined;
}

/** Runs one call's steps in order; the caller makes sure calls never overlap. Never rejects. */
export async function runSteps(steps: readonly AgentStepCall[], call: CallContext, env: ActEnvironment): Promise<ActResult> {
  const done: ActStepResult[] = [];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]!;
    let message: string | undefined;
    try {
      message = await runStep(step, call, env, (result) => {
        done.push(freeze({ step: index, ref: step.ref, ...result }));
      });
    } catch (error) {
      // A component that throws where nothing guards it (its snapshot, say) fails this step only.
      env.report(error);
      message = texts.broken(step);
    }
    if (message !== undefined) return failed(index, message, done);
  }
  return freeze({ ok: true as const, steps: freeze(done) });
}

type Done = { result?: AgentValue; gone?: true };

/**
 * The gates a step passes, in order: the agent's `allow`, then the call's. A step runs only when
 * every gate there is answered `true`; the first refusal ends the questions. Without the agent's
 * gate a step that needs a person cannot be approved, so it goes to the person and the call's gate
 * is not asked: a call's gate narrows what the agent lets through and never widens it.
 */
type Approval =
  | { readonly kind: 'approved' }
  | { readonly kind: 'refused'; readonly asked: boolean; readonly timedOut: boolean }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'gone' };

const APPROVED: Approval = freeze({ kind: 'approved' });
const NOBODY_ASKED: Approval = freeze({ kind: 'refused', asked: false, timedOut: false });

/** Answers at once when no gate is asked, so `run` starts in the same tick as `check`. */
function approve(
  step: AgentStepCall, needsPerson: boolean, call: CallContext, env: ActEnvironment, live: () => boolean,
): Approval | Promise<Approval> {
  const gates: Allow[] = [];
  if (env.allow) gates.push(env.allow);
  else if (needsPerson) return NOBODY_ASKED;
  if (call.allow) gates.push(call.allow);
  if (gates.length === 0) return APPROVED;
  return ask(gates, freeze({ ref: step.ref, action: step.action, args: step.args, needsPerson }), call, env, live);
}

// Both gates read the same frozen question: what the call's gate approves is what the agent's did.
async function ask(gates: readonly Allow[], question: AllowStep, call: CallContext, env: ActEnvironment, live: () => boolean): Promise<Approval> {
  for (const gate of gates) {
    // Each answer has the whole timeout: a person may be the one answering the second question.
    const answer = await wait((own) => gate(question, freeze({ signal: own })), call.signal, env.timeout);
    if (answer.kind === 'cancelled' || call.signal?.aborted) return { kind: 'cancelled' };
    if (answer.kind === 'error') env.report(answer.error);
    if (!live()) return { kind: 'gone' };
    if (answer.kind !== 'value' || answer.value !== true) return { kind: 'refused', asked: true, timedOut: answer.kind === 'timeout' };
  }
  return APPROVED;
}

/** Returns the error message, or undefined after reporting the step as done. */
async function runStep(step: AgentStepCall, call: CallContext, env: ActEnvironment, succeed: (result: Done) => void): Promise<string | undefined> {
  const { signal } = call;
  if (signal?.aborted) return texts.cancelledBefore(step);
  const located = env.locate(step.ref);
  if (!located.found) return texts.noEntry(step.ref, env.refs());
  const { component, entry, live } = located;
  const { check, run, summon } = component;
  if (!check || !run) return texts.noSteps(step);

  let verdict: AgentStepCheck;
  try { verdict = check.call(component, step); } catch (error) { env.report(error); return texts.broken(step); }
  if (!isObject(verdict)) { env.report(new TypeError('check() must return an object')); return texts.broken(step); }
  if (verdict.available !== true) return typeof verdict.message === 'string' ? verdict.message : texts.unavailable(step, entry.actions);
  const { permission } = verdict;
  let { names } = verdict;
  // Anything but the two known grants is treated as a denial: an unclear answer never runs a step.
  if (permission !== 'allow' && permission !== 'confirm') {
    if (permission !== 'deny') env.report(new TypeError(`Unknown permission: ${String(permission)}`));
    return texts.denied(step, names);
  }
  const needsPerson = permission === 'confirm';

  const pending = approve(step, needsPerson, call, env, live);
  const approval = pending instanceof Promise ? await pending : pending;
  if (approval.kind === 'cancelled') return texts.cancelledBefore(step);
  if (approval.kind === 'gone') return texts.noEntry(step.ref, env.refs());
  if (approval.kind === 'refused') {
    const { asked, timedOut } = approval;
    if (!needsPerson) return timedOut ? texts.noAnswer(step) : texts.saidNo(step);
    // The wait may have been long: the handoff names what the person will find now, not what was there.
    if (asked) {
      let fresh: AgentStepCheck;
      try { fresh = check.call(component, step); } catch (error) { env.report(error); return texts.broken(step); }
      if (!isObject(fresh)) { env.report(new TypeError('check() must return an object')); return texts.broken(step); }
      if (fresh.available !== true) {
        if (typeof fresh.message === 'string') return fresh.message;
        const now = env.locate(step.ref);
        return now.found ? texts.unavailable(step, now.entry.actions) : texts.noEntry(step.ref, env.refs());
      }
      if (fresh.permission !== 'allow' && fresh.permission !== 'confirm') return texts.denied(step, fresh.names);
      // No longer a step for a person: it was asked about as one and not approved, so it does not
      // run, and nobody is called to it.
      if (fresh.permission === 'allow') return timedOut ? texts.noAnswer(step) : texts.saidNo(step);
      names = fresh.names;
    }
    let reached = false;
    let note: string | undefined;
    if (summon) {
      try {
        const summoned: unknown = summon.call(component, step);
        if (!isObject(summoned)) reached = summoned === true;
        else if (typeof summoned.reached === 'boolean' && typeof summoned.note === 'string') {
          reached = summoned.reached;
          note = summoned.note;
        } else env.report(new TypeError('summon() must return a boolean or { reached, note }'));
      } catch (error) { env.report(error); }
    }
    return texts.needsPerson(step, names, reached, note);
  }

  const outcome = await wait<AgentRunOutcome>((own) => run.call(component, step, freeze({ signal: own, approved: permission })), signal, env.timeout);
  switch (outcome.kind) {
    case 'cancelled': return texts.cancelledDuring(step);
    case 'timeout': succeed({ result: 'pending' }); return undefined;
    case 'error': env.report(outcome.error); return texts.broken(step);
  }
  const value: unknown = outcome.value;
  if (!isObject(value)) { env.report(new TypeError('run() must return an object')); return texts.broken(step); }
  switch (value.status) {
    case 'done': {
      const result: Done = {};
      if (value.result !== undefined) {
        try { result.result = cloneValue(value.result); } catch (error) { env.report(error); }
      }
      if (value.gone === true) result.gone = true;
      succeed(result);
      return undefined;
    }
    case 'failed':
      if (typeof value.message === 'string') return value.message;
      break;
    case 'unavailable': {
      if (typeof value.message === 'string') return value.message;
      const fresh = env.locate(step.ref);
      return fresh.found ? texts.unavailable(step, fresh.entry.actions) : texts.noEntry(step.ref, env.refs());
    }
    case 'stale': return texts.stale(step);
  }
  env.report(new TypeError(`Unknown run() outcome: ${String(value.status)}`));
  return texts.broken(step);
}
