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
    { ref: 'toaster:3', action: 'fill', args: ['Reply', 'On my way'] },
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
  refuse.
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

## License

MIT
