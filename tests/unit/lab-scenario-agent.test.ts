import { describe, expect, it } from 'vitest';
import type { AgentToolResult } from '@cloudlet/agent';
// The laboratory's scripted agent: it must find its refs in what the tools answer, never know them.
import { runScenario, SCENARIO } from '../../apps/lab/src/scenario-agent.js';
import type { ScenarioCall, ScenarioCallTool } from '../../apps/lab/src/scenario-agent.js';

type Entry = Record<string, unknown> & { ref: string; component: string; actions: string[] };

/** A page whose refs are made up on every run, answering the tools the way the bridge would. */
function fakePage(prefix: string, change: (entries: Entry[]) => void = () => {}) {
  const toaster = `${prefix}`;
  let entries: Entry[] = [
    { ref: toaster, component: 'toaster', actions: ['open', 'clear'], island: { open: false } },
    { ref: `${toaster}:7`, component: 'notification', actions: ['dismiss', 'press'], label: SCENARIO.undoTitle, action: { label: SCENARIO.undoLabel, agent: 'allow' } },
    { ref: `${toaster}:8`, component: 'notification', actions: ['dismiss'], label: SCENARIO.dismissTitle, action: null },
    { ref: `${toaster}:9`, component: 'notification', actions: ['dismiss', 'cancel'], label: SCENARIO.operationTitle, operation: { status: 'pending' } },
    { ref: `${prefix}-picker`, component: 'color-picker', actions: ['set'], label: SCENARIO.picker, value: '#ff3b30' },
    { ref: `${prefix}-palette`, component: 'color-palette', actions: ['set', 'add', 'remove'], label: SCENARIO.palette, colors: ['#34c759'] },
  ];
  change(entries);
  const callTool: ScenarioCallTool = async (name, input) => {
    if (name === 'cloudlet_snapshot') return { entries, verbs: {} } as unknown as AgentToolResult;
    const steps = (input as { steps: { ref: string; action: string; args?: unknown[] }[] }).steps;
    const done = [];
    for (const [index, step] of steps.entries()) {
      const entry = entries.find(item => item.ref === step.ref);
      if (!entry?.actions.includes(step.action)) return { ok: false, error: { step: index, message: `No ${step.action} on ${step.ref}` }, steps: done, changes: [] };
      if (step.action === 'press' || step.action === 'dismiss') entries = entries.filter(item => item !== entry);
      if (step.action === 'open') entry.island = { open: true };
      if (step.action === 'cancel') entry.operation = { status: 'cancelled' };
      if (step.action === 'set') entry.value = step.args?.[0];
      if (step.action === 'add') entry.colors = [...entry.colors as string[], step.args?.[0]];
      if (step.action === 'remove') { entry.colors = (entry.colors as string[]).filter((_, at) => at !== step.args?.[0]); entry.actions = ['set', 'add', 'remove']; }
      done.push({ step: index, ref: step.ref });
    }
    return { ok: true, steps: done, changes: [] };
  };
  return callTool;
}

describe('laboratory scenario agent', () => {
  it('walks the whole path on refs it read from the snapshot', async () => {
    const calls: ScenarioCall[] = [];
    const outcome = await runScenario(fakePage('main-4f'), { onCall: call => calls.push(call) });
    expect(outcome.ok).toBe(true);
    expect(calls.map(call => call.tool)).toEqual(['cloudlet_snapshot', 'cloudlet_act', 'cloudlet_act', 'cloudlet_act', 'cloudlet_snapshot']);
    const steps = calls.filter(call => call.tool === 'cloudlet_act').flatMap(call => (call.input as { steps: { ref: string; action: string; args?: unknown[] }[] }).steps);
    expect(steps).toEqual([
      { ref: 'main-4f:7', action: 'press' }, { ref: 'main-4f:8', action: 'dismiss' },
      { ref: 'main-4f', action: 'open' }, { ref: 'main-4f:9', action: 'cancel' },
      // Colors the components do not hold yet, so each step changes something.
      { ref: 'main-4f-picker', action: 'set', args: ['#34c759'] }, { ref: 'main-4f-palette', action: 'add', args: ['#ff3b30'] },
    ]);
  });

  it('makes room in a full palette before adding, in the same call', async () => {
    const calls: ScenarioCall[] = [];
    const outcome = await runScenario(fakePage('full', entries => { entries[5]!.actions = ['set', 'remove']; entries[5]!.colors = ['#ff3b30', '#34c759']; }), { onCall: call => calls.push(call) });
    expect(outcome.ok).toBe(true);
    expect((calls[3]!.input as { steps: unknown[] }).steps.slice(1)).toEqual([
      { ref: 'full-palette', action: 'remove', args: [1] }, { ref: 'full-palette', action: 'add', args: ['#af52de'] },
    ]);
  });

  it('presses only an "Undo" the app lets an agent press', async () => {
    const outcome = await runScenario(fakePage('x', entries => { entries[1]!.action = { label: SCENARIO.undoLabel }; }));
    expect(outcome).toEqual({ ok: false, summary: `Not in the snapshot: a notification "${SCENARIO.undoTitle}" with "${SCENARIO.undoLabel}" an agent may press; a closed Island to open.` });
  });

  it('makes no step when a target is missing, and says which', async () => {
    const calls: ScenarioCall[] = [];
    const outcome = await runScenario(fakePage('y', entries => { entries[3]!.actions = ['dismiss']; }), { onCall: call => calls.push(call) });
    expect(outcome.summary).toBe(`Not in the snapshot: an operation "${SCENARIO.operationTitle}" to cancel.`);
    expect(calls).toHaveLength(1);
  });

  it('reports a step the page refused', async () => {
    const page = fakePage('z');
    const refusing: ScenarioCallTool = async (name, input) => {
      const result = await page(name, input);
      return name === 'cloudlet_act' && JSON.stringify(input).includes('"open"') ? { ok: false, error: { step: 0, message: 'The person is using the Island. Try again later.' }, steps: [], changes: [] } : result;
    };
    expect(await runScenario(refusing)).toEqual({ ok: false, summary: 'cloudlet_act stopped at step 0: The person is using the Island. Try again later.' });
  });

  it('stops before the next call once aborted, and pauses between calls', async () => {
    const controller = new AbortController();
    let pauses = 0;
    const outcome = await runScenario(fakePage('w'), { signal: controller.signal, pause: async () => { pauses += 1; if (pauses === 2) controller.abort(); } });
    expect(outcome).toEqual({ ok: false, summary: 'Cancelled after 2 calls.' });
  });
});
