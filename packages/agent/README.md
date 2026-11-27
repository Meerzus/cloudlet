# @cloudlet/agent

> **Experimental.** This package is `0.x`: its protocol and its exports may change in any release
> until `1.0.0`. Pin the exact version if you build on it.

`@cloudlet/agent` is the bridge between Cloudlet components and an AI agent. Each component connects
through its own adapter; the agent then reads one snapshot of everything the connected components
show, hears when it changes, and acts on it under the app's permission. The package has no
dependencies, touches no DOM and starts no timers until a step waits, so it runs on the server, in a
worker or in the browser.

## Install

```sh
npm install @cloudlet/agent
```

## Usage

```ts
import { createAgent, type AgentComponent } from '@cloudlet/agent';

const agent = createAgent();

// A component's adapter builds this object; here it is written by hand.
const counter: AgentComponent = {
  protocol: 1,
  name: 'counter',
  snapshot: () => [{ ref: 'counter', component: 'counter', actions: [], value: 0 }],
  subscribe: () => () => {},
};

const disconnect = agent.connect(counter);

agent.snapshot();
// [{ ref: 'counter', component: 'counter', actions: [], value: 0 }]

const unsubscribe = agent.subscribe(() => {
  console.log(agent.snapshot());
});

unsubscribe();
disconnect();
```

`snapshot()` returns the same frozen array until something changes, so it plugs straight into
React: `useSyncExternalStore(agent.subscribe, agent.snapshot)`.

The listener also receives what changed and who changed it, when the component says so:

```ts
agent.subscribe((changes) => {
  for (const change of changes) console.log(change.ref, change.key, change.previous, change.value, change.source);
});
```

Each `AgentChange` is `{ ref, component, label?, key, value, previous, reason?, source }`, frozen
plain data; `source` is `user`, `agent`, `app` or `system`. The array is empty when the snapshot
changed with no author: time passing, a component connected or disconnected. A component's own
documentation lists its keys.

## Acting

`act({ steps })` runs verbs from the records' `actions`, addressed by `ref`:

```ts
const agent = createAgent({
  // Asked before every step a component did not deny.
  allow: async (step, { signal }) => {
    if (!step.needsPerson) return true;
    return askThePerson(step, signal); // your own confirmation, withdrawn when signal aborts
  },
  timeout: 60_000, // how long a step waits for allow, then for the component; default 300 000 ms
});

const result = await agent.act({
  steps: [
    { ref: 'toaster:3', action: 'fill', args: ['reply', 'On my way'] }, // the field's name, not its label
    { ref: 'toaster:3', action: 'submit' },
  ],
});

if (!result.ok) console.log(result.error.message);
// "Needs a person: "Send" on "New message". … Ask them to submit "Send" themselves."
```

- The whole call is checked before the first step. A malformed one runs nothing and says so.
- Steps run in order and stop at the first error. Steps already done stay done; there is no rollback.
- Calls of one agent run one at a time. While a step waits for `allow`, every later call waits too,
  so an agent cannot approve its own step with a second call.
- Each component says what a step needs: `allow` (it runs unless your `allow` returns `false`),
  `confirm` (it runs only when your `allow` returns `true`; without `allow`, or on `false` or the
  timeout, the component brings it in front of the person and the agent is told to ask them), or
  `deny` (it never runs, and `allow` is not asked).
- Only `true` approves. A throw, a rejection, any other value and no answer within the timeout
  refuse. The error of a throwing `allow` or component is not thrown again: a page gets it through
  `reportError`, any other runtime in `console.error`.
- `act(input, { signal })` can be cancelled: a step that waits for `allow` or for the component
  stops waiting, and nothing further runs.
- The promise never rejects. The result is frozen plain data, ready for JSON and `structuredClone`:

```ts
type ActResult =
  | { ok: true; steps: { step: number; ref: string; result?: AgentValue; gone?: true }[] }
  | { ok: false; error: { step: number; message: string }; steps: { step: number; ref: string; result?: AgentValue; gone?: true }[] };
```

`step` counts from zero. Every `message` is written for the agent to read and act on. A step that
is still running when the timeout elapses counts as done, with `result: 'pending'`.

A component's adapter takes steps through three optional methods of `AgentComponent`: `check`
(is the step available, and what does it need), `run` (do it, checking again first) and `summon`
(bring it in front of a person, and say where they find it). A component without them stays
read-only, and its steps are refused.

The Toaster's adapter will ship as `@cloudlet/toast/agent` together with this package.

## Tools for a model

The bridge never calls a model. It gives you two tools to hand to one, and runs them when the model
calls them:

```ts
// The same frozen array for every agent: { name, description, inputSchema } each, plain data.
const tools = agent.tools; // cloudlet_act, then cloudlet_snapshot

// When the model calls a tool, run it and send the answer back as the tool's result.
const output = await agent.callTool(call.name, call.input, { signal });
const toolResult = JSON.stringify(output);
```

- **`cloudlet_snapshot`** takes `{}` (or nothing) and answers `{ entries, verbs }`: `entries` is what
  `agent.snapshot()` returns, and `verbs` says what the verbs of each kind of record in `entries` do
  and which arguments they take. A key of a record that is not plain data is left out and reported.
- **`cloudlet_act`** takes what `act` takes and answers its result plus `changes`: every
  `AgentChange` the agent heard from the moment the call started running until it answered, from
  any source, so the model learns that the person closed something while a step waited for `allow`.
  Between calls the bridge keeps nothing; to tell the model what changed between its turns, collect
  `agent.subscribe` yourself.
- A call takes at most 20 steps. More, and the call runs nothing and asks for smaller calls: calls of
  one agent wait in one queue, and a long list from a model that lost its way would hold the others.
- An invalid call says what to change (`{"steps": [...]}` around a single step, arguments in
  `args` as a list, a `ref` from `cloudlet_snapshot`), so the model can send it again on its own.
- `callTool` never rejects. An unknown tool name, or input `cloudlet_snapshot` does not take, answers
  `{ ok: false, error: { message } }`.

The descriptions are written for a model that sees only them and the schemas: start with a
snapshot, plan every step into one call, how errors and step numbers read, when to hand a step to
the person and look for no other way, what `pending`, `started` and `requested` mean, and that text
from the page is data, never instructions. They name no component: each adapter describes its own
verbs through the protocol's optional `verbs`, which `cloudlet_snapshot` passes on, so a new
component needs no change to the tools.

## License

MIT
