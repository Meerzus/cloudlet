import type { Allow, AllowStep } from '@cloudlet/agent';

/** How the laboratory answers the agent's `allow` question. */
export type AllowMode = 'none' | 'true' | 'false' | 'ask';

/** A step waiting for Approve or Deny in “ask”. */
export type PendingStep = { readonly id: number; readonly step: AllowStep };

export type AllowGateState = { readonly mode: AllowMode; readonly pending: PendingStep | null };

/**
 * The one `allow` the laboratory's agent is created with. It reads the switch on every question,
 * so changing the switch never recreates the agent (and never drops its queue).
 *
 * “No callback” answers exactly as the bridge does without `allow`: a step of the `allow` class
 * runs, a step that needs a person does not (and the bridge summons the person). A plain
 * `() => false` would differ: the bridge would refuse `allow`-class steps with “The app said no”.
 */
export function createAllowGate() {
  let state: AllowGateState = { mode: 'none', pending: null };
  let answer: ((value: boolean) => void) | undefined;
  let serial = 0;
  const listeners = new Set<() => void>();
  const publish = (next: AllowGateState) => { state = next; for (const listener of listeners) listener(); };
  const settle = (value: boolean) => {
    const resolve = answer;
    answer = undefined;
    if (state.pending) publish({ ...state, pending: null });
    resolve?.(value);
  };

  const allow: Allow = (step, { signal }) => {
    switch (state.mode) {
      case 'none': return !step.needsPerson;
      case 'true': return true;
      case 'false': return false;
      case 'ask': break;
    }
    // Calls of one agent run one at a time, so at most one step waits here.
    return new Promise<boolean>(resolve => {
      const id = ++serial;
      const onAbort = () => { if (state.pending?.id === id) settle(false); };
      answer = value => { signal.removeEventListener('abort', onAbort); resolve(value); };
      signal.addEventListener('abort', onAbort, { once: true });
      publish({ ...state, pending: { id, step } });
    });
  };

  return {
    allow,
    getState: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setMode: (mode: AllowMode) => { if (mode !== state.mode) publish({ ...state, mode }); },
    approve: () => settle(true),
    deny: () => settle(false),
  };
}

export type AllowGate = ReturnType<typeof createAllowGate>;
