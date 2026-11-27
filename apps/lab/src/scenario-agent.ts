import type { AgentToolResult } from '@cloudlet/agent';

/**
 * A scripted agent that walks the bridge's path through its two tools only, the way a model would:
 * it reads `cloudlet_snapshot`, picks refs by the labels and actions in the JSON it got back, and
 * plans its steps into `cloudlet_act` calls. No DOM, no controller, no ref known in advance.
 *
 * It imports nothing at runtime, so an end-to-end test can run it in Node against a page's tools.
 */

/** What the laboratory puts on screen before a run, and what the script looks for by label. */
export const SCENARIO = {
  /** A notification whose command the app lets an agent press without a person (`agent: 'allow'`). */
  undoTitle: 'Email archived',
  undoLabel: 'Undo',
  /** A plain notification to close. */
  dismissTitle: 'Link copied',
  /** A tracked operation that can be cancelled. */
  operationTitle: 'Uploading photos',
  /** The color picker and palette, by the labels the app gave them. */
  picker: 'Accent color',
  palette: 'Brand palette',
} as const;

/** The tools as the script calls them: any `agent.callTool`, or a test's bridge to a page's. */
export type ScenarioCallTool = (name: string, input: unknown, options?: { readonly signal?: AbortSignal }) => Promise<AgentToolResult>;

/** One tool call of a run, as it went. */
export interface ScenarioCall {
  readonly tool: string;
  readonly input: unknown;
  readonly output: AgentToolResult;
}

export interface ScenarioOutcome {
  readonly ok: boolean;
  /** One line: what the run did, or where and why it stopped. */
  readonly summary: string;
}

export interface ScenarioOptions {
  /** Hears each call once its answer is in. */
  readonly onCall?: (call: ScenarioCall) => void;
  /** Awaited before every call after the first, so a person can watch the screen change. */
  readonly pause?: () => Promise<void>;
  /** Passed to every call; an aborted run stops before its next call. */
  readonly signal?: AbortSignal;
}

/** Only what the script reads from a record; anything else in the JSON is ignored. */
type Entry = {
  readonly ref: string;
  readonly component: string;
  readonly actions: readonly string[];
  readonly label?: string;
  readonly value?: string;
  readonly colors?: readonly string[];
  readonly island?: { readonly open: boolean };
  readonly action?: { readonly label?: string; readonly agent?: string } | null;
  readonly operation?: { readonly status?: string } | null;
};

const COLORS = ['#ff3b30', '#34c759', '#af52de', '#ffcc00', '#5856d6', '#ff9500'] as const;
/** A color none of `taken` is, so the step changes something. */
const freshColor = (taken: readonly string[]) => COLORS.find(color => !taken.some(other => other.toLowerCase() === color)) ?? COLORS[0];
const sameColor = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();
const can = (entry: Entry | undefined, action: string) => entry?.actions.includes(action) === true;

/**
 * Runs the path: read, press "Undo", dismiss, open the Island, cancel the operation, set the
 * picker, add to the palette (removing its last color first when it is full).
 */
export async function runScenario(callTool: ScenarioCallTool, options: ScenarioOptions = {}): Promise<ScenarioOutcome> {
  const { onCall, pause, signal } = options;
  let calls = 0;
  const call = async (tool: string, input: unknown) => {
    if (calls > 0) await pause?.();
    if (signal?.aborted) throw new Cancelled();
    calls += 1;
    const output = await callTool(tool, input, signal ? { signal } : undefined);
    onCall?.({ tool, input, output });
    return output;
  };
  /** The records the tool answered, or its error message. */
  const snapshot = async (): Promise<readonly Entry[] | string> => {
    const output = await call('cloudlet_snapshot', {});
    if ('entries' in output) return output.entries as readonly Entry[];
    return 'error' in output ? output.error.message : 'no entries in the answer';
  };

  try {
    const entries = await snapshot();
    if (typeof entries === 'string') return { ok: false, summary: `cloudlet_snapshot failed: ${entries}` };

    const notifications = entries.filter(entry => entry.component === 'notification');
    const undo = notifications.find(entry => can(entry, 'press') && entry.label === SCENARIO.undoTitle && entry.action?.label === SCENARIO.undoLabel && entry.action.agent === 'allow');
    const link = notifications.find(entry => can(entry, 'dismiss') && entry.label === SCENARIO.dismissTitle);
    const upload = notifications.find(entry => can(entry, 'cancel') && entry.label === SCENARIO.operationTitle);
    // The Toaster that holds these notifications: a notification's ref starts with its Toaster's.
    const toaster = entries.find(entry => entry.component === 'toaster' && undo?.ref.startsWith(`${entry.ref}:`));
    const picker = entries.find(entry => entry.component === 'color-picker' && entry.label === SCENARIO.picker);
    const palette = entries.find(entry => entry.component === 'color-palette' && entry.label === SCENARIO.palette);
    const missing = [
      [undo, `a notification "${SCENARIO.undoTitle}" with "${SCENARIO.undoLabel}" an agent may press`],
      [link, `a notification "${SCENARIO.dismissTitle}" to dismiss`],
      [upload, `an operation "${SCENARIO.operationTitle}" to cancel`],
      [can(toaster, 'open') ? toaster : undefined, 'a closed Island to open'],
      [can(picker, 'set') ? picker : undefined, `a picker "${SCENARIO.picker}"`],
      [can(palette, 'add') || can(palette, 'remove') ? palette : undefined, `a palette "${SCENARIO.palette}" that can take a color`],
    ].flatMap(([found, what]) => found ? [] : [what as string]);
    if (missing.length || !undo || !link || !upload || !toaster || !picker || !palette) return { ok: false, summary: `Not in the snapshot: ${missing.join('; ')}.` };

    const accent = freshColor(picker.value ? [picker.value] : []);
    // A full palette has no `add`: make room by removing its last color first, in the same call.
    const colors = palette.colors ?? [];
    const room = can(palette, 'add') ? [] : [{ ref: palette.ref, action: 'remove', args: [colors.length - 1] }];
    const added = freshColor(colors);
    const plan = [
      [{ ref: undo.ref, action: 'press' }, { ref: link.ref, action: 'dismiss' }],
      [{ ref: toaster.ref, action: 'open' }, { ref: upload.ref, action: 'cancel' }],
      [{ ref: picker.ref, action: 'set', args: [accent] }, ...room, { ref: palette.ref, action: 'add', args: [added] }],
    ];
    let steps = 0;
    for (const group of plan) {
      const output = await call('cloudlet_act', { steps: group });
      if (!('ok' in output) || !output.ok) {
        const error = 'error' in output ? output.error : { message: 'no answer' };
        return { ok: false, summary: `cloudlet_act stopped${'step' in error ? ` at step ${error.step}` : ''}: ${error.message}` };
      }
      steps += group.length;
    }

    const after = await snapshot();
    if (typeof after === 'string') return { ok: false, summary: `cloudlet_snapshot failed: ${after}` };
    const find = (ref: string) => after.find(entry => entry.ref === ref);
    const upAfter = find(upload.ref);
    const wrong = [
      [!find(undo.ref), `"${SCENARIO.undoTitle}" is still there after "${SCENARIO.undoLabel}"`],
      [!find(link.ref), `"${SCENARIO.dismissTitle}" is still there`],
      [find(toaster.ref)?.island?.open === true, 'the Island is not open'],
      [!upAfter || upAfter.operation?.status !== 'pending', `"${SCENARIO.operationTitle}" is still running`],
      [sameColor(find(picker.ref)?.value, accent), `the picker does not show ${accent}`],
      [find(palette.ref)?.colors?.some(color => sameColor(color, added)) === true, `the palette has no ${added}`],
    ].flatMap(([holds, what]) => holds ? [] : [what as string]);
    if (wrong.length) return { ok: false, summary: `The steps ran, but ${wrong.join('; ')}.` };
    return { ok: true, summary: `Done: ${steps} steps in ${plan.length} act calls, ${calls} calls in all; the page shows each change.` };
  } catch (error) {
    if (error instanceof Cancelled) return { ok: false, summary: `Cancelled after ${calls} calls.` };
    throw error;
  }
}

class Cancelled extends Error {}
