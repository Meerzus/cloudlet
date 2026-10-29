import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CloudletProvider, Toaster, createCloudlet } from '@cloudlet/toast';
import type { ReactCloudletController, ReactNotificationSpec } from '@cloudlet/toast';
import { fixtureLabels, islandState, nonce, toasterQuery } from './fixture-kit.js';
import type { IslandState } from './fixture-kit.js';
import { closeCurrent, collapseIsland, keepIslandOnLabControls, openIsland } from './pilot.js';

type Kind = 'auto-description' | 'auto-action' | 'auto-plain' | 'open-plain' | 'stack-action';
type LogLine = { at: number; text: string };

export interface AttentionFixtureApi {
  show: (kind: Kind) => string;
  /** Two auto candidates at once: only the newest opens the Island. */
  pair: () => void;
  clear: () => void;
  snapshot: () => IslandState;
  log: () => readonly LogLine[];
}
export interface SliderFixtureApi {
  reset: (count?: number) => void;
  add: () => void;
  open: () => boolean;
  closeCurrent: () => boolean;
  collapse: () => boolean;
  snapshot: () => IslandState;
}
declare global {
  interface Window { attentionFixture?: AttentionFixtureApi; sliderFixture?: SliderFixtureApi }
}

const host = () => document.querySelector('.cloudlet-host');
const run = () => undefined;

/** Records whose `attention` resolves differently (DESIGN §5); the expectation is in the label. */
const kinds: Record<Kind, { label: string; expect: string; spec: (n: number) => ReactNotificationSpec }> = {
  'auto-description': { label: 'auto + description', expect: 'opens after the delay, reason attention', spec: n => ({ title: `Description ${n}`, description: { kind: 'text', text: 'Has a description: auto opens the Island.' } }) },
  'auto-action': { label: 'auto + action', expect: 'opens after the delay', spec: n => ({ title: `Action ${n}`, action: { kind: 'command', label: 'Undo', run } }) },
  'auto-plain': { label: 'auto, plain', expect: 'stays in the stack', spec: n => ({ title: `Plain ${n}` }) },
  'open-plain': { label: 'open, plain', expect: 'opens after the delay', spec: n => ({ title: `Always open ${n}`, attention: 'open' }) },
  'stack-action': { label: 'stack + action', expect: 'stays in the stack', spec: n => ({ title: `Stack only ${n}`, attention: 'stack', action: { kind: 'command', label: 'Undo', run } }) },
};

function useIsland(controller: ReactCloudletController) {
  useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  return islandState(controller);
}

/**
 * `?fixture=attention[&delay=600&theme=&dir=&position=&timeScale=]`: deterministic auto-open.
 * Every record is persistent; the log stamps each Island change with ms since the last admission.
 */
export function createAttentionFixture(params: URLSearchParams) {
  const controller = createCloudlet({ autoDismiss: false });
  const query = toasterQuery(params);
  const raw = Number(params.get('delay') ?? '600');
  const delay = Number.isFinite(raw) && raw >= 0 ? raw : 600;
  const element = <CloudletProvider controller={controller}><AttentionFixture controller={controller} delay={delay} query={query} /></CloudletProvider>;
  return { controller, element };
}

function AttentionFixture({ controller, delay, query }: { controller: ReactCloudletController; delay: number; query: ReturnType<typeof toasterQuery> }) {
  const state = useIsland(controller);
  const [log, setLog] = useState<readonly LogLine[]>([]);
  const admitted = useRef(performance.now());
  const serial = useRef(0);
  useEffect(() => keepIslandOnLabControls(window), []);
  useEffect(() => {
    let last = '';
    const lines: LogLine[] = [];
    const record = () => {
      const next = islandState(controller);
      const text = next.state === 'island' ? `island · ${next.reason} · current=${next.current}` : `stack · top=${next.current ?? '—'}`;
      if (text === last) return;
      last = text;
      lines.push({ at: Math.round(performance.now() - admitted.current), text });
      setLog([...lines]);
    };
    const unsubscribe = controller.subscribe(record);
    const show = (kind: Kind) => {
      const id = `${kind}-${++serial.current}`;
      admitted.current = performance.now();
      controller.show({ id, duration: null, ...kinds[kind].spec(serial.current) });
      return id;
    };
    const api: AttentionFixtureApi = {
      show,
      pair: () => { show('auto-description'); show('auto-action'); },
      clear: () => { controller.clear(); lines.length = 0; last = ''; setLog([]); },
      snapshot: () => islandState(controller),
      log: () => [...lines],
    };
    window.attentionFixture = api;
    return () => { unsubscribe(); if (window.attentionFixture === api) delete window.attentionFixture; };
  }, [controller]);

  return <>
    <main>
      <p className="eyebrow">Attention</p>
      <h1>Auto-open</h1>
      <p>Delay <code>Toaster attention.delay</code> = <b data-testid="attention-delay">{delay}</b> ms (query <code>delay</code>). While the pointer is over the notifications or focus is inside, the auto-open waits and then sits out the delay again. Keep the pointer away to see the clean timing.</p>
      <table>
        <thead><tr><th>Button</th><th>Expected</th></tr></thead>
        <tbody>{(Object.keys(kinds) as Kind[]).map(kind => <tr key={kind}><td>
          <button type="button" data-lab-keep-island="" onClick={() => window.attentionFixture?.show(kind)}>{kinds[kind].label}</button></td><td>{kinds[kind].expect}</td></tr>)}
          <tr><td><button type="button" data-lab-keep-island="" onClick={() => window.attentionFixture?.pair()}>Two candidates</button></td><td>opens on the newer one only (“Action”)</td></tr>
        </tbody>
      </table>
      <div className="controls"><button type="button" onClick={() => window.attentionFixture?.clear()}>Clear</button></div>
      <output data-testid="attention-state" data-state={state.state} data-reason={state.reason ?? ''} data-current={state.current ?? ''}>
        {state.state === 'island' ? `Island · ${state.reason} · ${state.current}` : `Stack · ${state.stack.length}`}
      </output>
      <ol className="fixture-log" data-testid="attention-log" aria-label="Transitions">{log.map((line, index) => <li key={index}>+{line.at} ms · {line.text}</li>)}</ol>
    </main>
    <Toaster position={query.position} theme={query.theme} dir={query.dir} attention={{ delay }} motion={{ timeScale: query.timeScale }} labels={fixtureLabels} {...(nonce() ? { nonce: nonce()! } : {})} />
  </>;
}

const sliderRecords: readonly ReactNotificationSpec[] = [
  { id: 'slide-1', title: 'Draft saved', kind: 'success', description: { kind: 'text', text: 'Changes are stored locally.' } },
  { id: 'slide-2', title: 'File uploaded', kind: 'info', description: { kind: 'text', text: 'report.pdf · 2.4 MB' }, action: { kind: 'command', label: 'Open', run } },
  { id: 'slide-3', title: 'New comment', description: { kind: 'text', text: 'Anna: “Could you look at the second section, please?”' } },
  { id: 'slide-4', title: 'Low disk space', kind: 'warning' },
  { id: 'slide-5', title: 'Payment failed', kind: 'error', description: { kind: 'text', text: 'The bank declined the card.' } },
  { id: 'slide-6', title: 'Syncing', kind: 'loading', progress: { kind: 'determinate', value: 0.4 } },
];

/**
 * `?fixture=slider[&count=3&dir=&theme=&position=&timeScale=]`: `count` records (default 3,
 * up to 12; more than 5 switch the indicator to text), Island opened from the pill (reason `user`).
 */
export function createSliderFixture(params: URLSearchParams) {
  const controller = createCloudlet({ autoDismiss: false });
  const query = toasterQuery(params);
  const count = Math.min(12, Math.max(1, Math.round(Number(params.get('count') ?? '3')) || 3));
  const element = <CloudletProvider controller={controller}><SliderFixture controller={controller} count={count} query={query} /></CloudletProvider>;
  return { controller, element };
}

function SliderFixture({ controller, count, query }: { controller: ReactCloudletController; count: number; query: ReturnType<typeof toasterQuery> }) {
  const state = useIsland(controller);
  useEffect(() => keepIslandOnLabControls(window), []);
  useEffect(() => {
    let added = 0;
    let frame = 0;
    const reset = (total = count) => {
      controller.clear();
      for (let index = 0; index < total; index++) {
        const base = sliderRecords[index % sliderRecords.length]!;
        controller.show({ ...base, id: index < sliderRecords.length ? base.id! : `slide-${index + 1}`, title: index < sliderRecords.length ? base.title : `${base.title} · ${index + 1}`, duration: null, attention: 'stack' });
      }
      // The pill exists once the host has measured it: open on the first frame it is there.
      let tries = 0;
      const open = () => { if (!openIsland(host()) && ++tries < 120) frame = requestAnimationFrame(open); };
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(open);
    };
    const api: SliderFixtureApi = {
      reset,
      add: () => { controller.show({ id: `added-${++added}`, title: `New notification ${added}`, duration: null, attention: 'stack' }); },
      open: () => openIsland(host()),
      closeCurrent: () => closeCurrent(host()),
      collapse: () => collapseIsland(host()),
      snapshot: () => islandState(controller),
    };
    window.sliderFixture = api;
    reset();
    return () => { cancelAnimationFrame(frame); if (window.sliderFixture === api) delete window.sliderFixture; };
  }, [controller, count]);

  return <>
    <main>
      <p className="eyebrow">Slider</p>
      <h1>Slider</h1>
      <p>{count} notifications, the Island opened from the pill. Page with ← / → / Home / End, the dots or a swipe; “close” moves to the older one. The buttons below never collapse the Island.</p>
      <div className="controls" data-lab-keep-island="">
        <button type="button" onClick={() => window.sliderFixture?.add()}>Add on top</button>
        <button type="button" onClick={() => window.sliderFixture?.closeCurrent()} disabled={state.state !== 'island'}>Close current</button>
        <button type="button" onClick={() => window.sliderFixture?.collapse()} disabled={state.state !== 'island'}>Collapse</button>
        <button type="button" onClick={() => window.sliderFixture?.open()} disabled={state.state === 'island' || !state.stack.length}>Open</button>
        <button type="button" onClick={() => window.sliderFixture?.reset()}>Reset</button>
      </div>
      <output data-testid="slider-state" data-state={state.state} data-current={state.current ?? ''}>
        {state.state === 'island' ? `Island · ${state.reason} · ${state.current} (${state.stack.indexOf(state.current ?? '') + 1}/${state.stack.length})` : `Stack · ${state.stack.length}`}
      </output>
    </main>
    <Toaster position={query.position} theme={query.theme} dir={query.dir} motion={{ timeScale: query.timeScale }} labels={fixtureLabels} {...(nonce() ? { nonce: nonce()! } : {})} />
  </>;
}
