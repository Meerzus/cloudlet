import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// The laboratory's “Agent” panel: the live snapshot of `@cloudlet/agent` over both controllers.

type Entry = { ref: string; component: string; actions: string[]; [key: string]: unknown };
type ToasterEntry = Entry & { island: { open: boolean; current: string | null }; count: number; overflow: { count: number; pending: boolean }; mounted: boolean };
type FieldEntry = {
  name: string;
  label: string;
  kind: string;
  required: boolean;
  maxLength: number | null;
  inputMode: string | null;
  filled: boolean;
  filledBy: 'app' | 'user' | 'agent' | null;
  error: string | null;
};
type NotificationEntry = Entry & { label: string; action: { kind: string; fields?: FieldEntry[] } | null; draft: boolean };

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const host = (page: Page) => page.locator('.lab-main-host');
const summary = (page: Page) => page.getByTestId('agent-summary');

async function entries(page: Page): Promise<Entry[]> {
  return JSON.parse(await page.getByTestId('agent-snapshot').textContent() ?? '[]') as Entry[];
}
async function toaster(page: Page, name = 'toaster') {
  return (await entries(page)).find(entry => entry.component === 'toaster' && entry.ref === name) as ToasterEntry | undefined;
}
async function notifications(page: Page) {
  return (await entries(page)).filter((entry): entry is NotificationEntry => entry.component === 'notification');
}

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('One Island');
});
test.afterEach(() => { expect(errors).toEqual([]); });

test('the panel shows the toaster entry right after load', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Agent snapshot, JSON' })).toBeVisible();
  await expect.poll(() => toaster(page)).toMatchObject({ ref: 'toaster', count: 0, island: { open: false, current: null }, mounted: true });
  await expect.poll(() => toaster(page, 'secondary')).toMatchObject({ ref: 'secondary', count: 0 });
  await expect(summary(page)).toHaveAttribute('data-entries', '2');
  await expect(summary(page)).toContainText('Island closed');
});

test('a shown notification appears with its title', async ({ page }) => {
  await button(page, 'Show notification').click();
  await expect.poll(async () => (await notifications(page)).map(entry => [entry.ref, entry.label])).toEqual([['toaster:1', 'Changes saved']]);
  await expect.poll(() => toaster(page).then(entry => entry?.count)).toBe(1);
  await expect(summary(page)).toHaveAttribute('data-entries', '3');
});

test('opening the Island shows in the toaster entry, with its current notification', async ({ page }) => {
  await button(page, '3 notifications').click();
  await button(page, 'Open Island').click();
  await expect(host(page)).toHaveAttribute('data-state', 'island');
  await expect(summary(page)).toHaveAttribute('data-island', 'true');
  const current = (await notifications(page)).find(entry => entry.label === 'New comment');
  await expect.poll(() => toaster(page).then(entry => entry?.island)).toEqual({ open: true, current: current?.ref });
  await expect(summary(page)).toContainText(`Island open · ${current?.ref}`);
  // The panel's own clicks do not collapse the Island.
  await page.getByTestId('agent-snapshot').click();
  await expect(host(page)).toHaveAttribute('data-state', 'island');
  await button(page, 'Collapse').click();
  await expect(summary(page)).toHaveAttribute('data-island', 'false');
});

test('overflow shows the number not accepted', async ({ page }) => {
  await button(page, 'Overflow · 101').click();
  await expect(summary(page)).toHaveAttribute('data-overflow', '1');
  await expect.poll(() => toaster(page)).toMatchObject({ count: 100, overflow: { count: 1, pending: true } });
  expect((await toaster(page))?.actions).toContain('acknowledge');
  await button(page, 'Acknowledge missed').click();
  await expect.poll(() => toaster(page).then(entry => entry?.overflow.pending)).toBe(false);
});

test('a notification of the second controller has a ref starting with secondary:', async ({ page }) => {
  await button(page, 'Show in second').click();
  await expect.poll(async () => (await notifications(page)).map(entry => [entry.ref, entry.label])).toEqual([['secondary:1', 'Second controller']]);
  await expect.poll(() => toaster(page, 'secondary').then(entry => entry?.count)).toBe(1);
});

test('a form notification shows its fields and whether they are filled, never the typed text', async ({ page }) => {
  const attention = page.getByRole('group', { name: 'attention', exact: true });
  await attention.getByRole('radio', { name: 'open', exact: true }).check();
  await button(page, 'With form').click();
  await expect(host(page)).toHaveAttribute('data-state', 'island');
  const form = async () => (await notifications(page)).find(entry => entry.action?.kind === 'form');
  await expect.poll(async () => (await form())?.action?.fields).toEqual([{ name: 'reply', label: 'Reply', kind: 'text', required: true, maxLength: 120, inputMode: null, filled: false, filledBy: null, error: null }]);
  const typed = 'Secret reply 7f3a';
  await page.getByRole('textbox', { name: 'Reply', exact: true }).fill(typed);
  await expect.poll(async () => (await form())?.action?.fields?.[0]?.filled).toBe(true);
  expect((await form())?.action?.fields?.[0]?.filledBy).toBe('user');
  expect((await form())?.draft).toBe(true);
  await expect(page.getByTestId('agent-snapshot')).not.toContainText(typed);
});

test('Recreate main, Reset second and Full reset reconnect without errors and show the new state', async ({ page }) => {
  await button(page, 'Show notification').click();
  await button(page, 'Show in second').click();
  await expect(summary(page)).toHaveAttribute('data-entries', '4');
  await button(page, 'Recreate main').click();
  await expect.poll(async () => (await entries(page)).map(entry => entry.ref)).toEqual(['toaster', 'secondary', 'secondary:1']);
  await button(page, 'Reset second').click();
  await expect.poll(async () => (await entries(page)).map(entry => entry.ref)).toEqual(['toaster', 'secondary']);
  await button(page, 'Show notification').click();
  await button(page, 'Show in second').click();
  await expect(summary(page)).toHaveAttribute('data-entries', '4');
  await button(page, 'Full reset').click();
  await expect.poll(async () => (await entries(page)).map(entry => entry.ref)).toEqual(['toaster', 'secondary']);
  await button(page, 'Dispose main').click();
  await expect.poll(async () => (await entries(page)).map(entry => entry.ref)).toEqual(['secondary']);
  await button(page, 'Unmount laboratory').click();
  await button(page, 'Mount laboratory').click();
  await expect.poll(async () => (await entries(page)).map(entry => entry.ref)).toEqual(['toaster', 'secondary']);
});

// Steps: the panel sends `act` calls through the same agent and answers `allow` from its switch.

type StepResult = { ok: boolean; error?: { step: number; message: string }; steps: { step: number; ref: string; result?: unknown; gone?: true }[] };

const agentPanel = (page: Page) => page.locator('#agent');
const callField = (page: Page) => page.getByTestId('agent-call');

async function attention(page: Page, value: 'auto' | 'open' | 'stack') {
  await page.getByRole('group', { name: 'attention', exact: true }).getByRole('radio', { name: value, exact: true }).check();
}
async function allow(page: Page, label: 'No callback' | 'Always true' | 'Always false' | 'Ask') {
  await page.getByRole('group', { name: 'allow', exact: true }).getByRole('radio', { name: label, exact: true }).check();
}
async function presetStep(page: Page, verb: string) {
  await agentPanel(page).getByRole('group', { name: 'Step presets' }).getByRole('button', { name: verb, exact: true }).click();
  return (JSON.parse(await callField(page).inputValue()) as { steps: { ref: string }[] }).steps[0]?.ref ?? '';
}
/** The newest log entry once its call has settled. */
async function latest(page: Page): Promise<StepResult> {
  const item = page.getByTestId('agent-log').locator('li').first();
  await expect(item).toHaveAttribute('data-status', /^(ok|error)$/u);
  return JSON.parse(await item.getByTestId('agent-result').textContent() ?? 'null') as StepResult;
}
async function run(page: Page, verb: string) {
  const ref = await presetStep(page, verb);
  await button(page, 'Run steps').click();
  return { ref, result: await latest(page) };
}
async function entry(page: Page, ref: string) {
  return (await notifications(page)).find(item => item.ref === ref);
}

test('the toaster verbs and show and dismiss change the Toaster', async ({ page }) => {
  await attention(page, 'stack');
  await button(page, 'Plain').click();
  await button(page, 'Plain').click();
  await expect.poll(() => toaster(page).then(item => item?.count)).toBe(2);

  expect((await run(page, 'open')).result).toEqual({ ok: true, steps: [{ step: 0, ref: 'toaster' }] });
  await expect(host(page)).toHaveAttribute('data-state', 'island');
  expect((await run(page, 'close')).result.ok).toBe(true);
  await expect(summary(page)).toHaveAttribute('data-island', 'false');

  const shown = await run(page, 'show');
  expect(shown.result.ok).toBe(true);
  await expect.poll(() => toaster(page).then(item => item?.island)).toEqual({ open: true, current: shown.ref });
  expect((await run(page, 'close')).result.ok).toBe(true);
  await expect(summary(page)).toHaveAttribute('data-island', 'false');

  const dismissed = await run(page, 'dismiss');
  expect(dismissed.result.ok).toBe(true);
  await expect.poll(() => toaster(page).then(item => item?.count)).toBe(1);
  expect(await entry(page, dismissed.ref)).toBeUndefined();

  expect((await run(page, 'clear')).result.ok).toBe(true);
  await expect.poll(() => toaster(page).then(item => item?.count)).toBe(0);
});

test('press, fill and submit run with allow answering true', async ({ page }) => {
  await attention(page, 'stack');
  await allow(page, 'Always true');
  await button(page, 'With action').click();
  const pressed = await run(page, 'press');
  expect(pressed.result).toEqual({ ok: true, steps: [{ step: 0, ref: pressed.ref, gone: true }] });
  await expect(page.getByText(/^Undo for email \d+ done\.$/u)).toBeVisible();

  await button(page, 'With form').click();
  const filled = await run(page, 'fill');
  expect(filled.result.ok).toBe(true);
  await expect.poll(async () => (await entry(page, filled.ref))?.action?.fields?.[0]).toMatchObject({ name: 'reply', filled: true, filledBy: 'agent' });
  await expect(page.getByTestId('agent-snapshot')).not.toContainText('Hello from the agent');
  const submitted = await run(page, 'submit');
  expect(submitted.ref).toBe(filled.ref);
  expect(submitted.result).toEqual({ ok: true, steps: [{ step: 0, ref: filled.ref, gone: true }] });
  await expect(page.getByText(/^Reply \d+ sent: Hello from the agent$/u)).toBeVisible();
});

test('cancel requests the cancellation of a running operation', async ({ page }) => {
  await button(page, 'Cooperative cancel').click();
  await expect.poll(async () => (await notifications(page)).some(item => item.actions.includes('cancel'))).toBe(true);
  const cancelled = await run(page, 'cancel');
  expect(cancelled.result).toEqual({ ok: true, steps: [{ step: 0, ref: cancelled.ref, result: 'requested' }] });
  await expect(page.getByTestId('task-cancel')).toHaveAttribute('data-status', 'cancelled');
});

test('retry starts a failed operation again', async ({ page }) => {
  await attention(page, 'stack');
  await button(page, 'With retry').click();
  await expect.poll(async () => (await notifications(page)).some(item => item.actions.includes('retry'))).toBe(true);
  const retried = await run(page, 'retry');
  expect(retried.result).toEqual({ ok: true, steps: [{ step: 0, ref: retried.ref, result: 'started' }] });
  await expect.poll(async () => (await entry(page, retried.ref))?.operation).toMatchObject({ attempt: 2 });
});

test('acknowledge clears the pending overflow', async ({ page }) => {
  await button(page, 'Overflow · 101').click();
  await expect.poll(() => toaster(page).then(item => item?.overflow.pending)).toBe(true);
  expect((await run(page, 'acknowledge')).result.ok).toBe(true);
  await expect.poll(() => toaster(page).then(item => item?.overflow.pending)).toBe(false);
});

test('an unmarked action without a callback needs a person: the Island opens on it and focus stays', async ({ page }) => {
  await attention(page, 'stack');
  await expect(page.getByRole('group', { name: 'allow', exact: true }).getByRole('radio', { name: 'No callback', exact: true })).toBeChecked();
  await button(page, 'With action').click();
  const ref = await presetStep(page, 'press');
  await button(page, 'Run steps').click();
  const result = await latest(page);
  expect(result.ok).toBe(false);
  expect(result.error?.message).toMatch(/^Needs a person: "Undo" on "Email archived · \d+"\. The Island is open on it\. Ask them to press "Undo" themselves\.$/u);
  await expect.poll(() => toaster(page).then(item => item?.island)).toEqual({ open: true, current: ref });
  await expect(host(page)).toHaveAttribute('data-state', 'island');
  await expect(button(page, 'Run steps')).toBeFocused();
  expect(await entry(page, ref)).toBeDefined();
  await expect(page.getByTestId('agent-announcement')).toContainText('error. Needs a person');
});

test('in “Ask” the panel shows the waiting step; Approve runs it and a cancel stops another', async ({ page }) => {
  await attention(page, 'stack');
  await allow(page, 'Ask');
  await button(page, 'With action').click();
  const ref = await presetStep(page, 'press');
  await button(page, 'Run steps').click();
  const pending = page.getByTestId('agent-pending');
  await expect(pending).toContainText(`"ref":"${ref}"`);
  await expect(pending).toContainText('"needsPerson":true');
  await expect(page.getByTestId('agent-log').locator('li').first()).toHaveAttribute('data-status', 'running');
  await button(page, 'Approve').click();
  expect(await latest(page)).toEqual({ ok: true, steps: [{ step: 0, ref, gone: true }] });
  await expect(page.getByText(/^Undo for email \d+ done\.$/u)).toBeVisible();
  await expect(button(page, 'Approve')).toHaveCount(0);

  await button(page, 'With action').click();
  await presetStep(page, 'press');
  await button(page, 'Run steps').click();
  await expect(button(page, 'Approve')).toBeVisible();
  await button(page, 'Cancel running · 1').click();
  const cancelled = await latest(page);
  expect(cancelled.ok).toBe(false);
  expect(cancelled.error?.message).toMatch(/^Cancelled before "press"/u);
  await expect(button(page, 'Approve')).toHaveCount(0);
});

test('a denied action never runs, even with allow answering true; an allowed one needs no person', async ({ page }) => {
  await attention(page, 'stack');
  await allow(page, 'Always true');
  await button(page, 'Action · agent deny').click();
  await expect.poll(async () => (await notifications(page)).length).toBe(1);
  const [denied] = await notifications(page);
  expect(denied?.action).toMatchObject({ label: 'Delete backup', agent: 'deny' });
  expect(denied?.actions).not.toContain('press');
  await callField(page).fill(JSON.stringify({ steps: [{ ref: denied?.ref, action: 'press' }] }));
  await button(page, 'Run steps').click();
  const result = await latest(page);
  expect(result.ok).toBe(false);
  expect(result.error?.message).toContain('Not allowed: the app does not let an agent press "Delete backup"');
  expect(await entry(page, denied?.ref ?? '')).toBeDefined();
  await expect(page.getByText(/^Backup \d+ deleted\.$/u)).toHaveCount(0);

  await allow(page, 'No callback');
  await button(page, 'Action · agent allow').click();
  const pressed = await run(page, 'press');
  expect(pressed.result).toEqual({ ok: true, steps: [{ step: 0, ref: pressed.ref, gone: true }] });
  await expect(page.getByText(/^Filter \d+ reset\.$/u)).toBeVisible();
});

test('the agent fills the form, the person sends it from the Island and the callback gets the value', async ({ page }) => {
  await attention(page, 'stack');
  await button(page, 'With form').click();
  expect((await run(page, 'fill')).result.ok).toBe(true);
  await button(page, 'Open Island').click();
  await expect(host(page)).toHaveAttribute('data-state', 'island');
  const reply = host(page).getByRole('textbox', { name: 'Reply', exact: true });
  await expect(reply).toHaveValue('Hello from the agent');
  await host(page).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText(/^Reply \d+ sent: Hello from the agent$/u)).toBeVisible();
});

test('text the person typed never reaches the panel, and the agent cannot overwrite it', async ({ page }) => {
  await attention(page, 'open');
  await button(page, 'With form').click();
  await expect(host(page)).toHaveAttribute('data-state', 'island');
  const typed = 'Private words 91c2';
  await host(page).getByRole('textbox', { name: 'Reply', exact: true }).fill(typed);
  const { ref, result } = await run(page, 'fill');
  expect(result.ok).toBe(false);
  expect(result.error?.message).toBe('The person typed in "Reply". An agent can\'t overwrite it.');
  expect((await entry(page, ref))?.action?.fields?.[0]?.filledBy).toBe('user');
  await expect(host(page).getByRole('textbox', { name: 'Reply', exact: true })).toHaveValue(typed);
  await expect(agentPanel(page)).not.toContainText(typed);
});

test('invalid JSON is reported next to the field and nothing is sent', async ({ page }) => {
  await callField(page).fill('{ "steps": [');
  await button(page, 'Run steps').click();
  await expect(agentPanel(page).getByRole('alert')).toContainText('Not JSON');
  await expect(callField(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('agent-log')).toContainText('No calls yet.');
  await callField(page).fill('{ "steps": [{ "ref": "toaster", "action": 7 }] }');
  await button(page, 'Run steps').click();
  expect((await latest(page)).error?.message).toBe('Invalid call: steps[0].action must be a string. No step ran.');
});
