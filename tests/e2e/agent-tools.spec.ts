import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// The bridge's path through its two tools only: the test reads `cloudlet_snapshot`, picks every ref
// from the JSON the previous answer gave, sends `cloudlet_act` and checks the screen after each step.
// It calls the page agent's own `callTool`, which the laboratory puts on `window.__cloudletLab`.

type Entry = {
  ref: string;
  component: string;
  actions: string[];
  label?: string;
  value?: string;
  colors?: string[];
  island?: { open: boolean; current: string | null };
  action?: { kind: string; label?: string; agent?: string } | null;
  operation?: { status: string } | null;
};
type Snapshot = { entries: Entry[]; verbs: Record<string, unknown> };
type ActResult = { ok: boolean; error?: { step: number; message: string }; steps: { step: number; ref: string; result?: unknown; gone?: true }[]; changes: unknown[] };
type ToolError = { ok: false; error: { message: string } };
type LabWindow = Window & { __cloudletLab?: { callTool: (name: string, input?: unknown) => Promise<unknown> } };

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const host = (page: Page) => page.locator('.lab-main-host');

/** Calls a tool in the page and returns its JSON answer, as a model would get it. */
async function callTool<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const answer = await page.evaluate(async ([tool, value]) => {
    const hook = (window as LabWindow).__cloudletLab;
    if (!hook) throw new Error('The laboratory hook is not on window.');
    return JSON.stringify(await hook.callTool(tool, value));
  }, [name, input] as const);
  return JSON.parse(answer) as T;
}
const snapshot = (page: Page) => callTool<Snapshot>(page, 'cloudlet_snapshot', {});
const act = (page: Page, steps: unknown) => callTool<ActResult>(page, 'cloudlet_act', { steps });

/** What a call could change in a snapshot: refs, actions, labels, colors and the Island, not timers. */
const stable = ({ entries, verbs }: Snapshot) => ({
  verbs,
  entries: entries.map(({ ref, component, actions, label, value, colors, island, operation }) => ({ ref, component, actions, label, value, colors, island, status: operation?.status })),
});
/** A color the record does not hold yet, so a step changes something. */
const fresh = (taken: readonly string[]) => ['#ff3b30', '#34c759', '#af52de', '#ffcc00'].find(color => !taken.includes(color)) ?? '#5856d6';

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('One Island');
});
test.afterEach(() => { expect(errors).toEqual([]); });

test('the path through the tools: read, press an allowed action, dismiss, open, cancel, set and add', async ({ page }) => {
  // The app puts things on screen with its own buttons; the Island stays closed.
  await page.getByRole('group', { name: 'attention', exact: true }).getByRole('radio', { name: 'stack', exact: true }).check();
  await button(page, 'Action · agent allow').click();
  await button(page, 'Plain').click();
  await button(page, 'Cooperative cancel').click();

  // Read: the notifications, their actions and the verbs, all from the JSON.
  await expect.poll(async () => (await snapshot(page)).entries.filter(entry => entry.component === 'notification').length).toBe(3);
  const read = await snapshot(page);
  expect(Object.keys(read.verbs)).toEqual(expect.arrayContaining(['toaster', 'notification', 'color-picker', 'color-palette']));
  const notifications = read.entries.filter(entry => entry.component === 'notification');
  const allowed = notifications.find(entry => entry.actions.includes('press') && entry.action?.agent === 'allow');
  const link = notifications.find(entry => entry.actions.includes('dismiss') && entry.label?.startsWith('Link copied'));
  const upload = notifications.find(entry => entry.actions.includes('cancel'));
  const toaster = read.entries.find(entry => entry.component === 'toaster' && allowed?.ref.startsWith(`${entry.ref}:`));
  const picker = read.entries.find(entry => entry.component === 'color-picker' && entry.label === 'Accent color');
  const palette = read.entries.find(entry => entry.component === 'color-palette' && entry.label === 'Brand palette');
  if (!allowed || !link || !upload || !toaster || !picker || !palette) throw new Error(`Missing in the snapshot: ${JSON.stringify(read.entries)}`);
  expect(allowed.action).toMatchObject({ kind: 'command', label: 'Reset filter', agent: 'allow' });
  expect(toaster.island).toEqual({ open: false, current: null });
  expect(toaster.actions).toContain('open');

  // Press the action the app lets an agent press: no person is asked and the command runs.
  const pressed = await act(page, [{ ref: allowed.ref, action: 'press' }]);
  expect(pressed).toMatchObject({ ok: true, steps: [{ step: 0, ref: allowed.ref, gone: true }] });
  await expect(page.getByText(/^Filter \d+ reset\.$/u)).toBeVisible();

  const dismissed = await act(page, [{ ref: link.ref, action: 'dismiss' }]);
  expect(dismissed).toMatchObject({ ok: true, steps: [{ step: 0, ref: link.ref }] });
  await expect(page.getByTestId('agent-snapshot')).not.toContainText(link.label ?? '');

  const opened = await act(page, [{ ref: toaster.ref, action: 'open' }]);
  expect(opened).toMatchObject({ ok: true, steps: [{ step: 0, ref: toaster.ref }] });
  await expect(host(page)).toHaveAttribute('data-state', 'island');

  const cancelled = await act(page, [{ ref: upload.ref, action: 'cancel' }]);
  expect(cancelled).toMatchObject({ ok: true, steps: [{ step: 0, ref: upload.ref, result: 'requested' }] });
  await expect(page.getByTestId('task-cancel')).toHaveAttribute('data-status', 'cancelled');

  const accent = fresh(picker.value ? [picker.value] : []);
  const set = await act(page, [{ ref: picker.ref, action: 'set', args: [accent] }]);
  expect(set).toMatchObject({ ok: true, steps: [{ step: 0, ref: picker.ref, result: accent }] });
  await expect(page.getByTestId('colors-accent')).toHaveText(accent);

  const added = fresh(palette.colors ?? []);
  const grown = await act(page, [{ ref: palette.ref, action: 'add', args: [added] }]);
  expect(grown).toMatchObject({ ok: true, steps: [{ step: 0, ref: palette.ref }] });
  await expect(page.getByTestId('colors-palette')).toContainText(added);

  // The Island stayed open through the steps, and the last snapshot agrees with the screen.
  const after = await snapshot(page);
  const find = (ref: string) => after.entries.find(entry => entry.ref === ref);
  expect(find(allowed.ref)).toBeUndefined();
  expect(find(link.ref)).toBeUndefined();
  expect(find(toaster.ref)?.island?.open).toBe(true);
  expect(find(picker.ref)?.value).toBe(accent);
  expect(find(palette.ref)?.colors).toContain(added);
  await expect(host(page)).toHaveAttribute('data-state', 'island');
});

test('a wrong call through the tools says what to change and changes nothing on screen', async ({ page }) => {
  // A running operation has no timer, so nothing on screen changes by itself during the test.
  await button(page, 'Cooperative cancel').click();
  await expect.poll(async () => (await snapshot(page)).entries.some(entry => entry.actions.includes('cancel'))).toBe(true);
  const before = await snapshot(page);
  const target = before.entries.find(entry => entry.actions.includes('cancel'));
  if (!target) throw new Error('No notification to work on.');
  const accent = await page.getByTestId('colors-accent').textContent();
  const colors = await page.getByTestId('colors-palette').textContent();

  const invalid = (problem: string) => ({ ok: false, error: { step: 0, message: `Invalid call: ${problem}. No step ran.` }, steps: [], changes: [] });

  // A step without "steps" around it.
  expect(await callTool(page, 'cloudlet_act', { ref: target.ref, action: 'dismiss' }))
    .toEqual(invalid('a step came on its own; steps go in a list under "steps", even a single one: {"steps": [{"ref": "<ref>", "action": "<verb>"}]}'));
  // "value" where the arguments go in "args".
  expect(await act(page, [{ ref: 'color-picker', action: 'set', value: '#ff3b30' }]))
    .toEqual(invalid('steps[0] has "value", which a step doesn\'t take: arguments go in "args" as a list, like "args": ["<first>", "<second>"]'));
  // One step more than a call takes.
  expect(await act(page, Array.from({ length: 21 }, () => ({ ref: target.ref, action: 'dismiss' }))))
    .toEqual(invalid('21 steps is more than 20 in one call; split them into calls of at most 20 steps'));
  // A tool the agent does not have, and a key the snapshot does not take.
  expect(await callTool<ToolError>(page, 'cloudlet_click', { steps: [] }))
    .toEqual({ ok: false, error: { message: 'Unknown tool "cloudlet_click". Tools: cloudlet_act, cloudlet_snapshot.' } });
  expect(await callTool<ToolError>(page, 'cloudlet_snapshot', { verbose: true }))
    .toEqual({ ok: false, error: { message: 'cloudlet_snapshot takes no input: send {}. It got the key "verbose".' } });

  expect(stable(await snapshot(page))).toEqual(stable(before));
  await expect(page.getByTestId('agent-snapshot')).toContainText(target.label ?? '');
  await expect(page.getByTestId('task-cancel')).not.toHaveAttribute('data-status', 'cancelled');
  await expect(page.getByTestId('colors-accent')).toHaveText(accent ?? '');
  await expect(page.getByTestId('colors-palette')).toHaveText(colors ?? '');
  await expect(host(page)).not.toHaveAttribute('data-state', 'island');
});

test('Run walks the path: the log ends with the last snapshot and the page shows the result', async ({ page }) => {
  const summary = page.getByTestId('scenario-summary');
  await page.getByTestId('scenario-run').click();
  // Nothing on the page is touched while it runs: a click outside the Island would collapse it.
  await expect(summary).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(summary).toHaveText(/^Done: 6 steps in 3 act calls, 5 calls in all; /u);
  const lines = page.getByTestId('scenario-log').locator('li');
  await expect(lines).toHaveCount(5);
  expect(await lines.evaluateAll(items => items.map(item => [item.getAttribute('data-tool'), item.getAttribute('data-status')]))).toEqual([
    ['cloudlet_snapshot', 'ok'], ['cloudlet_act', 'ok'], ['cloudlet_act', 'ok'], ['cloudlet_act', 'ok'], ['cloudlet_snapshot', 'ok'],
  ]);

  await expect(host(page)).toHaveAttribute('data-state', 'island');
  const after = await snapshot(page);
  const labels = after.entries.filter(entry => entry.component === 'notification').map(entry => entry.label);
  expect(labels).not.toContain('Email archived');
  expect(labels).not.toContain('Link copied');
  const picker = after.entries.find(entry => entry.component === 'color-picker');
  await expect(page.getByTestId('colors-accent')).toHaveText(picker?.value ?? '');
  await expect(page.getByTestId('scenario-run')).toBeEnabled();
});

test('without WebMCP the laboratory registers nothing and logs no error or warning', async ({ page, browserName }) => {
  const logged: string[] = [];
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') logged.push(`${message.type()}: ${message.text()}`); });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('One Island');
  const state = page.getByTestId('webmcp-state');
  await expect(state).toHaveAttribute('data-supported', 'false');
  await expect(state).toHaveText('This browser has no WebMCP: nothing is registered.');
  // Removing and returning the tools is silent too.
  await page.getByTestId('webmcp-expose').uncheck();
  await expect(state).toHaveAttribute('data-exposed', 'false');
  await page.getByTestId('webmcp-expose').check();
  await expect(state).toHaveAttribute('data-exposed', 'true');
  expect(await page.evaluate(() => 'modelContext' in document), browserName).toBe(false);
  expect(logged).toEqual([]);
});
