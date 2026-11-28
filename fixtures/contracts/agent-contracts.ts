import {
  createAgent, registerTools, type ActResult, type Agent, type AgentChange, type AgentComponent, type AgentEntry, type Allow,
  type RegisterToolsOptions,
} from '@cloudlet/agent';

// Compile the bridge against its packed declarations alone: no DOM, no Node, no React.
const agent: Agent = createAgent();
const entry: AgentEntry = { ref: 'demo', component: 'demo', actions: ['open'], extra: { nested: true } };
const component: AgentComponent = {
  protocol: 1,
  name: 'demo',
  snapshot: () => [entry],
  subscribe: (listener) => { void listener; return () => {}; },
};
const disconnect: () => void = agent.connect(component);
const records: readonly AgentEntry[] = agent.snapshot();
const ref: string | undefined = records[0]?.ref;
const unsubscribe: () => void = agent.subscribe(() => {});
void [ref, unsubscribe];
disconnect();

// A subscriber may read what changed and who changed it; a component may say so.
const stop: () => void = agent.subscribe((changes) => {
  const first: AgentChange | undefined = changes[0];
  const source: 'user' | 'agent' | 'app' | 'system' | undefined = first?.source;
  // @ts-expect-error The records are read-only.
  changes.push(first!);
  void source;
});
const telling: AgentComponent = {
  ...component,
  name: 'telling',
  subscribe: (listener) => {
    listener([{ ref: 'demo', component: 'demo', key: 'open', value: true, previous: false, source: 'user' }]);
    listener();
    return () => {};
  },
};
void [stop, telling];

// @ts-expect-error Only protocol 1 exists.
const future: AgentComponent = { ...component, protocol: 2 };
void future;

// @ts-expect-error The snapshot is read-only.
agent.snapshot().push(entry);

// A component that takes steps adds check and run, and summon when a step can need a person.
const stepper: AgentComponent = {
  ...component,
  name: 'stepper',
  check: (step) => (step.action === 'open' ? { available: true, permission: 'confirm', names: { target: 'Open' } } : { available: false }),
  run: async (_step, { signal, approved }) => (signal.aborted ? { status: 'stale' } : { status: 'done', result: approved, gone: false }),
  summon: () => false,
};
const allow: Allow = async (step, { signal }) => !step.needsPerson && !signal.aborted;
const acting: Agent = createAgent({ allow, timeout: 60_000 });
acting.connect(stepper);
export async function act(): Promise<string> {
  const result: ActResult = await acting.act({ steps: [{ ref: 'demo', action: 'open', args: [] }] });
  return result.ok ? String(result.steps[0]?.result) : result.error.message;
}

// @ts-expect-error A step without a ref does not compile.
void acting.act({ steps: [{ action: 'open' }] });

// @ts-expect-error act is the only verb: the bridge has no run of its own.
agent.run;

// A call may carry its own allow, a second gate that only narrows the agent's.
export async function narrowed(): Promise<boolean> {
  const result: ActResult = await acting.act({ steps: [{ ref: 'demo', action: 'open' }] }, { allow: (step) => !step.needsPerson });
  return result.ok;
}

// WebMCP: allow is required; the removal is a plain function. No DOM types are needed.
const exposed: RegisterToolsOptions = { allow, onError: (error: unknown) => { void error; } };
const unexpose: () => void = registerTools(acting, exposed);
unexpose();
// @ts-expect-error registerTools needs allow.
registerTools(acting, {});
