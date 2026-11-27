# Changelog

## 0.1.0 — unreleased

Experimental first version: the agent reads and acts under the app's permission.

### Features

- `createAgent()` returns `{ connect, snapshot, subscribe, act }`.
- `agent.connect(component)` takes `{ protocol: 1, name, snapshot(), subscribe(listener) }` and
  returns an idempotent disconnect. An unknown `protocol`, a name outside `[a-z][a-z0-9-]*` and a
  name that is already connected throw a `TypeError`.
- `agent.snapshot()` returns the records of every connected component in connection order, as one
  frozen array that stays the same until something changes.
- `agent.subscribe(listener)` calls the listener on any change, connection or disconnection. One
  listener's error does not stop the others.
- The listener of `agent.subscribe` receives what changed and who changed it: a frozen array of
  `AgentChange` records `{ ref, component, label?, key, value, previous, reason?, source }`, where
  `source` is `user`, `agent`, `app` or `system`. A component passes the records to the listener it
  was given in `subscribe`; the array is empty when it passed none, on a connection and on a
  disconnection. Each record is copied from its known keys and frozen; one of another shape is left
  out and reported through `reportError` or `console.error`, and the rest still arrive; a list of
  more than 1 000 records is refused whole. A listener
  without parameters works as before, and so does a component that calls its listener with nothing.
- `createAgent({ allow?, timeout? })`: `allow(step, { signal })` is asked before every step a
  component did not deny and approves only with `true`; `timeout` (default 300 000 ms) bounds the
  wait for `allow` and then for the component. Anything else throws a `TypeError`.
- `agent.act({ steps }, { signal }?)` runs `{ ref, action, args? }` steps in order. The whole call
  is checked first; calls of one agent run one at a time; the first error stops the call and the
  steps before it stay done. A `confirm` step runs only when `allow` returns `true`; otherwise the
  component brings it in front of a person and the agent is told to ask them. A `deny` step never
  runs. Cancelling through `signal` stops the wait. The promise never rejects and resolves to a
  frozen `{ ok, error?: { step, message }, steps: [{ step, ref, result?, gone? }] }`.
- A step's `args` and what a step returns are plain data with finite numbers. `args` are copied
  deeply when the call is made, so what `allow` was asked about is what runs; a call whose `args`
  hold anything else, or whose input cannot be read, is an invalid call. A step keeps its ref only
  within the components connected when the call was made: one connected later under the same name
  is not searched. When a later step breaks inside its component, the steps before it stay in the
  result. A handoff to a person names the action that is there when `allow` answers, and a step
  that stopped needing a person while `allow` was asked is refused without calling one. A signal
  that throws when listened to is an invalid call. An error
  thrown by `allow` or by a component during a call is never thrown again: the call answers with a
  refusal, and the error goes to `reportError` in a page and to `console.error` anywhere else.
- The component protocol gains optional `check`, `run` and `summon`; a component without them stays
  read-only. `protocol` stays `1`. `summon` answers `true` or `false` (in front of the person now or
  not), or `{ reached, note }`, whose sentence the agent reads in place of the bridge's own.
- The component protocol gains optional `verbs`: by kind of record (the `component` of its records),
  each verb with a short text on its arguments, what it does and when it needs a person, for a model
  that has never seen the component's code. `protocol` stays `1`. `connect` copies and freezes it,
  so a later change of the object is not seen, and throws a `TypeError` for anything but an object of
  objects of non-empty strings. When two components describe the same kind, the one connected first
  is used.
- `agent.tools` gives the bridge's two tools for a model, `cloudlet_act` and `cloudlet_snapshot`,
  as `{ name, description, inputSchema }`: one frozen array of plain data for every agent.
  `agent.callTool(name, input, { signal }?)` runs one and answers plain data, never rejecting.
  `cloudlet_snapshot` takes `{}` or nothing and answers `{ entries, verbs }`: the records, with any
  key that is not plain data left out and reported, and the verbs of the kinds present.
  `cloudlet_act` takes what `act` takes, waits in the same queue and answers its result with
  `changes`: what `agent.subscribe` heard from the moment the call started running until it
  answered, whoever made it. An unknown name or input `cloudlet_snapshot` does not take answers
  `{ ok: false, error: { message } }`.
- An invalid call says what to change: a step sent without `steps`, a bare list, `value` in a step
  (arguments go in `args` as a list), `args` that are not a list, a step without `ref` or `action`.
  A call takes at most 20 steps; more is an invalid call that asks for smaller calls.
- Types: `Agent`, `AgentComponent`, `AgentEntry`, `AgentOptions`, `Allow`, `AllowStep`, `AgentStep`,
  `ActInput`, `ActOptions`, `ActResult`, `ActStepResult`, `AgentPermission`, `AgentStepCall`,
  `AgentStepCheck`, `AgentStepNames`, `AgentRunContext`, `AgentRunOutcome`, `AgentSummonOutcome`,
  `AgentSignal`, `AgentValue`, `AgentVerbs`, `AgentTool`, `AgentToolName`, `AgentCallTool`,
  `AgentToolResult`, `AgentSnapshotToolResult`, `AgentActToolResult`, `AgentToolError`.
