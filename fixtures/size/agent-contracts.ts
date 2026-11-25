import { createAgent, type Agent, type AgentComponent, type AgentEntry } from '@cloudlet/agent';

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

// @ts-expect-error Only protocol 1 exists.
const future: AgentComponent = { ...component, protocol: 2 };
void future;

// @ts-expect-error The snapshot is read-only.
agent.snapshot().push(entry);

// @ts-expect-error The bridge exposes no mutating verbs yet.
agent.run;
