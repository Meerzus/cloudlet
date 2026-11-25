import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Agent, AgentEntry } from '@cloudlet/agent';
import { toasterAgent } from '@cloudlet/toast/agent';
import type { ToasterEntry } from '@cloudlet/toast/agent';
import type { LabSession } from './lab-session.js';

/** The adapter of one session, kept while the session lives so its refs stay stable. */
function useToasterComponent(session: LabSession | undefined, name?: string) {
  return useMemo(() => session && toasterAgent(session.controller, name ? { name } : undefined), [session, name]);
}

/**
 * Connects both controllers to the page's one agent. Both reconnect together, main first, so the
 * snapshot keeps its order after “Recreate main”; the cleanup disconnects before the next connect,
 * so a recreated controller never meets its predecessor's name (StrictMode included).
 */
export function useLabAgent(agent: Agent, main: LabSession | undefined, secondary: LabSession | undefined) {
  const toaster = useToasterComponent(main);
  const second = useToasterComponent(secondary, 'secondary');
  useEffect(() => {
    const disconnects = [toaster, second].flatMap(component => component ? [agent.connect(component)] : []);
    return () => { for (const disconnect of disconnects) disconnect(); };
  }, [agent, toaster, second]);
}

const isMainToaster = (entry: AgentEntry): entry is ToasterEntry => entry.component === 'toaster' && entry.ref === 'toaster';

/** What an agent sees: the bridge's live snapshot of both controllers, read the way an app would. */
export function AgentPanel({ agent }: { agent: Agent }) {
  const entries = useSyncExternalStore(agent.subscribe, agent.snapshot, agent.snapshot);
  const toaster = entries.find(isMainToaster);
  const island = !toaster ? 'not connected' : toaster.island.open ? `Island open · ${toaster.island.current ?? '—'}` : 'Island closed';
  return <section id="agent" className="lab-agent" aria-labelledby="agent-title" data-lab-keep-island="">
    <div className="lab-diagnostic-head"><h2 id="agent-title">Agent</h2><span className="lab-mono">@cloudlet/agent · experimental</span></div>
    <p>One <code>createAgent()</code> reads both controllers: the main one as <code>toaster</code>, the second as <code>secondary</code>. This is the snapshot an agent gets: no React nodes, no functions, no form values.</p>
    <p className="lab-agent-summary" data-testid="agent-summary" data-entries={entries.length} data-island={toaster?.island.open ?? false} data-overflow={toaster?.overflow.count ?? 0}>
      <span><b>{entries.length}</b> entries</span><span>{island}</span><span><b>{toaster?.overflow.count ?? 0}</b> not accepted</span>
    </p>
    <pre className="lab-agent-snapshot" data-testid="agent-snapshot" tabIndex={0} role="region" aria-label="Agent snapshot, JSON">{JSON.stringify(entries, null, 2)}</pre>
  </section>;
}
