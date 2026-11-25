# @cloudlet/agent

> **Experimental.** This package is `0.x`: its protocol and its exports may change in any release
> until `1.0.0`. Pin the exact version if you build on it.

`@cloudlet/agent` is the bridge between Cloudlet components and an AI agent. Each component connects
through its own adapter; the agent then reads one snapshot of everything the connected components
show and hears when it changes. The package has no dependencies, touches no DOM and starts no
timers, so it runs on the server, in a worker or in the browser.

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

The Toaster's adapter will ship as `@cloudlet/toast/agent` together with this package.

## License

MIT
