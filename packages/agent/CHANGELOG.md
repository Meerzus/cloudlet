# Changelog

## 0.1.0 — unreleased

Experimental first version: the agent reads.

### Features

- `createAgent()` returns `{ connect, snapshot, subscribe }`.
- `agent.connect(component)` takes `{ protocol: 1, name, snapshot(), subscribe(listener) }` and
  returns an idempotent disconnect. An unknown `protocol`, a name outside `[a-z][a-z0-9-]*` and a
  name that is already connected throw a `TypeError`.
- `agent.snapshot()` returns the records of every connected component in connection order, as one
  frozen array that stays the same until something changes.
- `agent.subscribe(listener)` calls the listener on any change, connection or disconnection. One
  listener's error does not stop the others.
- Types: `Agent`, `AgentComponent`, `AgentEntry`.
