import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { registerTools } from '@cloudlet/agent';
import type { ActResult, Agent, AgentChange, AgentComponent, AgentEntry } from '@cloudlet/agent';
import { toasterAgent } from '@cloudlet/toast/agent';
import type { NotificationEntry, ToasterEntry } from '@cloudlet/toast/agent';
import type { ColorPickerEntry } from '@/components/ui/color-picker/color-picker-agent';
import type { ColorPaletteEntry } from '@/components/ui/color-palette/color-palette-agent';
import type { LabSession } from './lab-session.js';
import { createAllowGate } from './agent-allow.js';
import type { AllowGate, AllowMode } from './agent-allow.js';
import { Choice } from './choice.js';
import { runScenario } from './scenario-agent.js';
import type { ScenarioCall, ScenarioOutcome } from './scenario-agent.js';

/** The adapter of one session, kept while the session lives so its refs stay stable. */
function useToasterComponent(session: LabSession | undefined, name?: string) {
  return useMemo(() => session && toasterAgent(session.controller, name ? { name } : undefined), [session, name]);
}

/**
 * Components that mount below the laboratory (the color picker and palette) connect through this
 * instead of the agent: it holds them until the controllers are connected and connects them after,
 * so the controllers' records stay first in the snapshot, also after “Recreate main”.
 */
export interface LaterConnector { readonly connect: Agent['connect'] }
interface LaterHub extends LaterConnector { attach: (agent: Agent) => void; detach: () => void }

function createLaterHub(): LaterHub {
  const components = new Map<AgentComponent, (() => void) | null>();
  let target: Agent | null = null;
  return {
    connect: component => {
      if (components.has(component)) throw new TypeError(`A component named "${component.name}" is already connected`);
      components.set(component, target ? target.connect(component) : null);
      return () => {
        const disconnect = components.get(component);
        components.delete(component);
        disconnect?.();
      };
    },
    attach: agent => {
      target = agent;
      for (const component of components.keys()) components.set(component, agent.connect(component));
    },
    detach: () => {
      for (const [component, disconnect] of components) { disconnect?.(); components.set(component, null); }
      target = null;
    },
  };
}

/**
 * Connects both controllers to the page's one agent, then the components that came through the
 * returned connector. All reconnect together, main first, so the snapshot keeps its order after
 * “Recreate main”; the cleanup disconnects before the next connect, so a recreated controller never
 * meets its predecessor's name (StrictMode included).
 */
export function useLabAgent(agent: Agent, main: LabSession | undefined, secondary: LabSession | undefined): LaterConnector {
  const toaster = useToasterComponent(main);
  const second = useToasterComponent(secondary, 'secondary');
  const [later] = useState(createLaterHub);
  useEffect(() => {
    const disconnects = [toaster, second].flatMap(component => component ? [agent.connect(component)] : []);
    later.attach(agent);
    return () => {
      later.detach();
      for (const disconnect of disconnects) disconnect();
    };
  }, [agent, toaster, second, later]);
  return later;
}

const isMainToaster = (entry: AgentEntry): entry is ToasterEntry => entry.component === 'toaster' && entry.ref === 'toaster';
const isMainNotification = (entry: AgentEntry): entry is NotificationEntry => entry.component === 'notification' && entry.ref.startsWith('toaster:');

const TOASTER_VERBS = ['open', 'close', 'clear', 'acknowledge'] as const;
const NOTIFICATION_VERBS = ['show', 'dismiss', 'press', 'fill', 'submit', 'cancel', 'retry'] as const;
type Verb = typeof TOASTER_VERBS[number] | typeof NOTIFICATION_VERBS[number];
const FILL_VALUE = 'Hello from the agent';

/**
 * One step of the main controller for a preset: the toaster record for its own verbs; for the
 * others, the first notification that lists the verb now (else the first notification at all).
 */
function preset(verb: Verb, entries: readonly AgentEntry[]): string {
  let step: { ref: string; action: string; args?: unknown[] };
  if ((TOASTER_VERBS as readonly string[]).includes(verb)) step = { ref: 'toaster', action: verb };
  else {
    const notifications = entries.filter(isMainNotification);
    const target = notifications.find(entry => entry.actions.includes(verb)) ?? notifications[0];
    step = { ref: target?.ref ?? 'toaster:1', action: verb };
    if (verb === 'fill') step.args = [target?.action?.fields?.[0]?.name ?? 'reply', FILL_VALUE];
  }
  return JSON.stringify({ steps: [step] }, null, 2);
}

const isPicker = (entry: AgentEntry): entry is AgentEntry & ColorPickerEntry => entry.component === 'color-picker';
const isPalette = (entry: AgentEntry): entry is AgentEntry & ColorPaletteEntry => entry.component === 'color-palette';

const COLOR_PRESETS = [['picker-set', 'color-picker', 'set'], ['palette-set', 'color-palette', 'set'], ['palette-add', 'color-palette', 'add'], ['palette-remove', 'color-palette', 'remove']] as const;
type ColorPreset = typeof COLOR_PRESETS[number][0];
const SAMPLE_COLORS = ['#ff3b30', '#34c759', '#af52de', '#ffcc00', '#5856d6'] as const;
/** A sample color none of `taken` already is, so the step changes something. */
const freshColor = (taken: readonly string[]) => SAMPLE_COLORS.find(color => !taken.some(other => other.toLowerCase() === color)) ?? SAMPLE_COLORS[0];

/** One step for the color picker or palette, with the ref and arguments taken from the current snapshot. */
function colorPreset(kind: ColorPreset, entries: readonly AgentEntry[]): string {
  const picker = entries.find(isPicker);
  const palette = entries.find(isPalette);
  const colors = palette?.colors ?? [];
  const last = Math.max(colors.length - 1, 0);
  const step = kind === 'picker-set' ? { ref: picker?.ref ?? 'color-picker', action: 'set', args: [freshColor(picker ? [picker.value] : [])] }
    : kind === 'palette-set' ? { ref: palette?.ref ?? 'color-palette', action: 'set', args: [last, freshColor(colors)] }
      : kind === 'palette-add' ? { ref: palette?.ref ?? 'color-palette', action: 'add', args: [freshColor(colors)] }
        : { ref: palette?.ref ?? 'color-palette', action: 'remove', args: [last] };
  return JSON.stringify({ steps: [step] }, null, 2);
}

type LogEntry = { id: number; call: unknown; result: ActResult | null };

const CHANGE_LIMIT = 80;
type ChangeEntry = { id: number; change: AgentChange };

/** The change records the bridge hands to `agent.subscribe`, as they came, newest first. */
function useAgentChanges(agent: Agent) {
  const [changes, setChanges] = useState<readonly ChangeEntry[]>([]);
  const serial = useRef(0);
  useEffect(() => agent.subscribe(records => {
    if (!records.length) return;
    // Reversed here, not in the updater: React may run an updater twice.
    const entries = records.map(change => ({ id: ++serial.current, change })).reverse();
    setChanges(previous => [...entries, ...previous].slice(0, CHANGE_LIMIT));
  }), [agent]);
  return changes;
}

const ALLOW_OPTIONS: readonly (readonly [AllowMode, string])[] = [['none', 'No callback'], ['true', 'Always true'], ['false', 'Always false'], ['ask', 'Ask']];

/** The steps half of the panel: compose an `act` call, answer `allow`, read the results. */
function AgentSteps({ agent, gate, entries }: { agent: Agent; gate: AllowGate; entries: readonly AgentEntry[] }) {
  const { mode } = useSyncExternalStore(gate.subscribe, gate.getState, gate.getState);
  const [text, setText] = useState(() => preset('open', entries));
  const [invalid, setInvalid] = useState<string | null>(null);
  const [log, setLog] = useState<readonly LogEntry[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const [running, setRunning] = useState(0);
  const controllers = useRef(new Set<AbortController>());
  const serial = useRef(0);
  const callId = useId();
  const errorId = useId();
  useEffect(() => () => { for (const controller of controllers.current) controller.abort(); }, []);

  const run = () => {
    let call: unknown;
    try { call = JSON.parse(text); } catch (error) {
      setInvalid(`Not JSON: ${error instanceof Error ? error.message : String(error)}. Nothing was sent.`);
      return;
    }
    setInvalid(null);
    const id = ++serial.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    setRunning(controllers.current.size);
    setLog(previous => [{ id, call, result: null }, ...previous]);
    // The bridge checks the shape of the call itself; the panel passes whatever the JSON holds.
    void agent.act(call as Parameters<Agent['act']>[0], { signal: controller.signal }).then(result => {
      controllers.current.delete(controller);
      setRunning(controllers.current.size);
      setLog(previous => previous.map(entry => entry.id === id ? { ...entry, result } : entry));
      setAnnouncement(result.ok ? `Call ${id}: ok.` : `Call ${id}: error. ${result.error.message}`);
    });
  };
  const cancel = () => { for (const controller of controllers.current) controller.abort(); };

  return <div className="lab-agent-steps">
    <div className="lab-agent-compose">
      <div className="lab-fields lab-fields-inline"><Choice label="allow" value={mode} onChange={gate.setMode} options={ALLOW_OPTIONS} /></div>
      <div className="lab-agent-presets" role="group" aria-label="Step presets">
        {[...TOASTER_VERBS, ...NOTIFICATION_VERBS].map(verb => <button key={verb} type="button" onClick={() => { setText(preset(verb, entries)); setInvalid(null); }}>{verb}</button>)}
      </div>
      <div className="lab-agent-presets" role="group" aria-label="Color step presets">
        {COLOR_PRESETS.map(([kind, component, verb]) => <button key={kind} type="button" onClick={() => { setText(colorPreset(kind, entries)); setInvalid(null); }}>{component} · {verb}</button>)}
      </div>
      <label htmlFor={callId} className="lab-agent-label">act call, JSON</label>
      <textarea id={callId} className="lab-agent-call" data-testid="agent-call" value={text} spellCheck={false} rows={9}
        aria-invalid={invalid !== null} aria-describedby={invalid ? errorId : undefined} onChange={event => setText(event.target.value)} />
      {invalid && <p id={errorId} className="lab-agent-invalid" role="alert">{invalid}</p>}
      <div className="lab-buttons">
        <button type="button" className="lab-primary" onClick={run}>Run steps</button>
        <button type="button" disabled={running === 0} onClick={cancel}>Cancel running{running > 0 ? ` · ${running}` : ''}</button>
        <button type="button" disabled={log.length === 0} onClick={() => { setLog([]); setAnnouncement('Log cleared.'); }}>Clear log</button>
      </div>
      <GatePending gate={gate} name="allow" testId="agent-pending" />
    </div>
    <div className="lab-agent-results">
      <h3>Results · newest first</h3>
      <p className="lab-hint" role="status" data-testid="agent-announcement">{announcement}</p>
      <ol className="lab-agent-log" data-testid="agent-log" tabIndex={0} aria-label="Agent calls and results">
        {log.length === 0 ? <li className="lab-empty">No calls yet.</li> : log.map(entry => {
          const status = entry.result === null ? 'running' : entry.result.ok ? 'ok' : 'error';
          return <li key={entry.id} data-status={status}>
            <span className="lab-agent-badge">#{entry.id} · {status}</span>
            <pre>{JSON.stringify(entry.call)}</pre>
            {entry.result && <pre data-testid="agent-result">{JSON.stringify(entry.result, null, 2)}</pre>}
          </li>;
        })}
      </ol>
    </div>
  </div>;
}

/** The step a gate in “Ask” waits on, with Approve and Deny. */
function GatePending({ gate, name, testId }: { gate: AllowGate; name: string; testId: string }) {
  const { mode, pending } = useSyncExternalStore(gate.subscribe, gate.getState, gate.getState);
  return <div className="lab-agent-pending" data-testid={testId} aria-live="polite">
    {pending ? <>
      <p><b>{name}</b> asks about <code>{JSON.stringify({ ref: pending.step.ref, action: pending.step.action, args: pending.step.args, needsPerson: pending.step.needsPerson })}</code></p>
      <div className="lab-buttons"><button type="button" onClick={gate.approve}>Approve</button><button type="button" onClick={gate.deny}>Deny</button></div>
    </> : mode === 'ask' ? <p className="lab-hint">No step is waiting for an answer.</p> : null}
  </div>;
}

/** Long enough to see each call change the screen. */
const SCENARIO_PAUSE = 700;
const wait = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  const timer = setTimeout(done, ms);
  function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
  signal.addEventListener('abort', done, { once: true });
});
type ScenarioLine = { id: number; call: ScenarioCall };
const callStatus = (call: ScenarioCall) => 'ok' in call.output ? (call.output.ok ? 'ok' : 'error') : 'error' in call.output ? 'error' : 'ok';

/**
 * Run prepares the page the way an app would, then hands the page agent's `callTool` to the
 * scripted agent, which sees only what the tools answer. One run at a time.
 */
function ScenarioAgent({ agent, session }: { agent: Agent; session: LabSession | undefined }) {
  const [lines, setLines] = useState<readonly ScenarioLine[]>([]);
  const [outcome, setOutcome] = useState<ScenarioOutcome | 'running' | null>(null);
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);
  const running = outcome === 'running';

  const run = async () => {
    if (current.current || !session) return;
    const controller = new AbortController();
    current.current = controller;
    setLines([]);
    setOutcome('running');
    session.prepareAgentScenario();
    let serial = 0;
    await wait(SCENARIO_PAUSE, controller.signal);
    const result = await runScenario(agent.callTool, {
      signal: controller.signal,
      pause: () => wait(SCENARIO_PAUSE, controller.signal),
      onCall: call => { const line = { id: ++serial, call }; setLines(previous => [...previous, line]); },
    });
    if (current.current !== controller) return;
    current.current = null;
    setOutcome(result);
  };

  const status = outcome === null ? 'idle' : outcome === 'running' ? 'running' : outcome.ok ? 'ok' : 'error';
  return <div className="lab-agent-scenario">
    <h3>Scenario agent</h3>
    <p className="lab-hint">Run puts three notifications on the main controller the way an app would: “Email archived” with an “Undo” marked <code>agent: 'allow'</code>, “Link copied” and a cancellable “Uploading photos”. Then a script that sees only the tools reads <code>cloudlet_snapshot</code>, picks refs by the labels in the JSON and plans <code>cloudlet_act</code> calls: press “Undo”, dismiss, open the Island, cancel the upload, set the accent color, add a brand color. It answers to the <b>allow</b> switch above. Pressing anything outside the Island while it runs collapses it and fails the check.</p>
    <div className="lab-buttons"><button type="button" className="lab-primary" data-testid="scenario-run" disabled={running || !session} onClick={() => void run()}>{running ? 'Running…' : 'Run'}</button></div>
    <ol className="lab-agent-log" data-testid="scenario-log" tabIndex={0} aria-label="Scenario agent calls and results">
      {lines.length === 0 ? <li className="lab-empty">{running ? 'Preparing the page…' : 'No run yet.'}</li> : lines.map(({ id, call }) => {
        const callState = callStatus(call);
        return <li key={id} data-status={callState} data-tool={call.tool}>
          <span className="lab-agent-badge">#{id} · {call.tool} · {callState}</span>
          <pre>{JSON.stringify(call.input)}</pre>
          <details><summary>Result</summary><pre data-testid="scenario-result">{JSON.stringify(call.output, null, 2)}</pre></details>
        </li>;
      })}
    </ol>
    <p className="lab-agent-outcome" role="status" data-testid="scenario-summary" data-status={status}>
      {outcome === null ? '' : outcome === 'running' ? 'Running…' : outcome.summary}
    </p>
  </div>;
}

const WEB_ALLOW_OPTIONS: readonly (readonly [AllowMode, string])[] = [['true', 'Agent’s allow decides'], ['false', 'Always false'], ['ask', 'Ask'], ['none', 'Not for a person']];
const hasWebMcp = () => typeof document !== 'undefined' && typeof (document as Document & { modelContext?: { registerTool?: unknown } }).modelContext?.registerTool === 'function';

/**
 * Registers the page agent's tools with the browser's agent through WebMCP, behind a second gate of
 * its own: the agent's `allow` answers first, then this one. Off removes them; so does unmounting.
 */
function WebMcpTools({ agent }: { agent: Agent }) {
  const [gate] = useState(() => createAllowGate('true'));
  const { mode } = useSyncExternalStore(gate.subscribe, gate.getState, gate.getState);
  const [expose, setExpose] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [supported] = useState(hasWebMcp);
  useEffect(() => {
    if (!expose) return;
    setFailure(null);
    return registerTools(agent, { allow: gate.allow, onError: error => setFailure(error instanceof Error ? `${error.name}: ${error.message}` : String(error)) });
  }, [agent, gate, expose]);
  const state = !supported ? 'This browser has no WebMCP: nothing is registered.' : failure ? `Registration failed: ${failure}` : expose ? 'cloudlet_act and cloudlet_snapshot are registered.' : 'Removed.';
  return <div className="lab-agent-webmcp">
    <h3>WebMCP</h3>
    <p className="lab-hint">The browser’s agent calls the same tools. A step it asks for runs only when both gates say yes: the <b>allow</b> switch above, then this one.</p>
    <div className="lab-checks"><label><input type="checkbox" data-testid="webmcp-expose" checked={expose} onChange={event => setExpose(event.target.checked)} />Expose to WebMCP</label></div>
    <div className="lab-fields lab-fields-inline"><Choice label="WebMCP allow" value={mode} onChange={gate.setMode} options={WEB_ALLOW_OPTIONS} /></div>
    <p className="lab-hint" data-testid="webmcp-state" data-supported={supported} data-exposed={expose}>{state}</p>
    <GatePending gate={gate} name="WebMCP allow" testId="webmcp-pending" />
  </div>;
}

/** What an agent sees and does: the bridge's live snapshot of both controllers and the colors, and `act` on them, used the way an app would. */
export function AgentPanel({ agent, gate, session }: { agent: Agent; gate: AllowGate; session: LabSession | undefined }) {
  const entries = useSyncExternalStore(agent.subscribe, agent.snapshot, agent.snapshot);
  const changes = useAgentChanges(agent);
  const toaster = entries.find(isMainToaster);
  const island = !toaster ? 'not connected' : toaster.island.open ? `Island open · ${toaster.island.current ?? '—'}` : 'Island closed';
  return <section id="agent" className="lab-agent" aria-labelledby="agent-title" data-lab-keep-island="">
    <div className="lab-diagnostic-head"><h2 id="agent-title">Agent</h2><span className="lab-mono">@cloudlet/agent · experimental</span></div>
    <p>One <code>createAgent()</code> sees three components: the Toaster with both controllers (the main one as <code>toaster</code>, the second as <code>secondary</code>), the color picker as <code>color-picker</code> and the palette as <code>color-palette</code>. This is the snapshot an agent gets: no React nodes, no functions, no form values.</p>
    <p>Presets put one step into the call: the first row for the main controller, the second for the colors, with a ref and arguments from the current snapshot. Pressing an action or submitting a form needs a person unless the action says <code>agent: 'allow'</code>; <code>agent: 'deny'</code> never runs. Steps never move focus.</p>
    <p>A model gets the same agent as two tools, <code>cloudlet_snapshot</code> and <code>cloudlet_act</code>: the scenario agent below walks the whole path through them, and the WebMCP block hands them to the browser’s agent. Tests call them as <code>window.__cloudletLab.callTool</code>.</p>
    <AgentSteps agent={agent} gate={gate} entries={entries} />
    <div className="lab-agent-tools">
      <ScenarioAgent agent={agent} session={session} />
      <WebMcpTools agent={agent} />
    </div>
    <details open className="lab-agent-changes"><summary>Changes · newest first · last {CHANGE_LIMIT}</summary>
      <p className="lab-hint">What <code>agent.subscribe</code> receives: what changed and who changed it (<code>user</code>, <code>agent</code>, <code>app</code>, <code>system</code>). A form field reports its author, never its text.</p>
      <ol className="lab-log" data-testid="agent-changes" tabIndex={0} aria-label="Agent change records">
        {changes.length === 0 ? <li className="lab-empty">No changes yet.</li> : changes.map(entry => <li key={entry.id}>{JSON.stringify(entry.change)}</li>)}
      </ol>
    </details>
    <p className="lab-agent-summary" data-testid="agent-summary" data-entries={entries.length} data-island={toaster?.island.open ?? false} data-overflow={toaster?.overflow.count ?? 0}>
      <span><b>{entries.length}</b> entries</span><span>{island}</span><span><b>{toaster?.overflow.count ?? 0}</b> not accepted</span>
    </p>
    <pre className="lab-agent-snapshot" data-testid="agent-snapshot" tabIndex={0} role="region" aria-label="Agent snapshot, JSON">{JSON.stringify(entries, null, 2)}</pre>
  </section>;
}
