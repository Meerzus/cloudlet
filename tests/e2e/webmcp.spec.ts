import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// The laboratory hands the agent's tools to the browser's agent through WebMCP. Runs only in the
// `chromium-webmcp` project, whose Chromium starts with `--enable-features=WebMCP`.

type BrowserTool = { name: string; annotations: Record<string, unknown> | null };
type ModelContext = {
  getTools: () => Promise<{ name: string; annotations?: Record<string, unknown> | null }[]>;
  executeTool: (tool: unknown, input: unknown) => Promise<unknown>;
};

/** The tools the browser's agent sees: name and annotations. */
async function browserTools(page: Page): Promise<BrowserTool[]> {
  return page.evaluate(async () => {
    const context = (document as Document & { modelContext: ModelContext }).modelContext;
    return (await context.getTools()).map(tool => ({ name: tool.name, annotations: tool.annotations ?? null })).sort((a, b) => a.name.localeCompare(b.name));
  });
}
/** Runs a tool the way the browser's agent does and returns the answer it gets, parsed from JSON. */
async function execute<T>(page: Page, name: string, input: unknown): Promise<T> {
  const answer = await page.evaluate(async ([tool, value]) => {
    const context = (document as Document & { modelContext: ModelContext }).modelContext;
    // Chromium 156 takes the tool object from getTools(), and the input as an object.
    const found = (await context.getTools()).find(item => item.name === tool);
    if (!found) throw new Error(`No tool ${tool} in getTools().`);
    const result = await context.executeTool(found, value);
    return typeof result === 'string' ? result : JSON.stringify(result);
  }, [name, input] as const);
  return JSON.parse(answer) as T;
}

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') errors.push(`${message.type()}: ${message.text()}`); });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('One Island');
  await expect(page.getByTestId('webmcp-state')).toHaveText('cloudlet_act and cloudlet_snapshot are registered.');
});
test.afterEach(() => { expect(errors).toEqual([]); });

test('the browser sees both tools with their annotations', async ({ page }) => {
  await expect(page.getByTestId('webmcp-state')).toHaveAttribute('data-supported', 'true');
  const tools = await browserTools(page);
  expect(tools.map(tool => tool.name)).toEqual(['cloudlet_act', 'cloudlet_snapshot']);
  expect(tools[0]?.annotations).toMatchObject({ consequentialHint: true, untrustedContentHint: true });
  expect(tools[1]?.annotations).toMatchObject({ readOnlyHint: true, untrustedContentHint: true });
});

test('executeTool answers JSON: the snapshot, a step that runs and an error as a value', async ({ page }) => {
  const read = await execute<{ entries: { ref: string; component: string; label?: string }[]; verbs: Record<string, unknown> }>(page, 'cloudlet_snapshot', {});
  expect(read.entries.map(entry => entry.ref)).toEqual(expect.arrayContaining(['toaster', 'secondary', 'color-picker', 'color-palette']));
  expect(Object.keys(read.verbs)).toEqual(expect.arrayContaining(['toaster', 'color-picker']));

  const wrong = await execute<{ ok: boolean; error: { step: number; message: string }; steps: unknown[] }>(page, 'cloudlet_act', { steps: [] });
  expect(wrong).toMatchObject({ ok: false, error: { step: 0 }, steps: [] });
  expect(wrong.error.message).toMatch(/^Invalid call: steps must be a non-empty list: .+ No step ran\.$/u);

  // A step that needs no person passes both gates and changes the screen.
  const set = await execute<{ ok: boolean; steps: { result?: unknown }[] }>(page, 'cloudlet_act', { steps: [{ ref: 'color-picker', action: 'set', args: ['#34c759'] }] });
  expect(set).toMatchObject({ ok: true, steps: [{ step: 0, ref: 'color-picker', result: '#34c759' }] });
  await expect(page.getByTestId('colors-accent')).toHaveText('#34c759');
});

test('“Expose to WebMCP” removes both tools and returns them', async ({ page }) => {
  const expose = page.getByTestId('webmcp-expose');
  await expose.uncheck();
  await expect(page.getByTestId('webmcp-state')).toHaveText('Removed.');
  await expect.poll(() => browserTools(page)).toEqual([]);
  await expose.check();
  await expect(page.getByTestId('webmcp-state')).toHaveText('cloudlet_act and cloudlet_snapshot are registered.');
  await expect.poll(async () => (await browserTools(page)).map(tool => tool.name)).toEqual(['cloudlet_act', 'cloudlet_snapshot']);
});
