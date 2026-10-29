// Drives real Safari through the VoiceOver scenarios with safaridriver,
// while scripts/voiceover-log.mjs records what VoiceOver speaks. A step log with timestamps and the
// focused element lets each scenario's speech be read off the speech log. macOS only.
//
//   node scripts/voiceover-safari-run.mjs [--only arrival,pill-island,slider,...] [--out-dir dir]
//
// Needs the lab served on 127.0.0.1:4173 (node scripts/serve-csp.mjs), VoiceOver on with AppleScript
// control (see scripts/voiceover-log.mjs) and Safari Settings > Developer > Allow remote automation.
// Safari runs the session in its own automation window; do not touch the keyboard or mouse meanwhile.
import { spawn } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    only: { type: 'string' },
    'out-dir': { type: 'string', default: 'artifacts/release/manual/1.0.0' },
    port: { type: 'string', default: '4448' },
    settle: { type: 'string', default: '15000' },
  },
});
const base = 'http://127.0.0.1:4173/';
const port = Number(values.port);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = resolve(values['out-dir']);
const speechFile = `${dir}/voiceover-safari-${stamp}.jsonl`;
const stepsFile = `${dir}/voiceover-safari-${stamp}-steps.jsonl`;
/** Time for VoiceOver to finish a phrase before the next key. */
const SPEAK = 2500;
const KEYS = { Enter: '', Escape: '', Tab: '', ArrowLeft: '', ArrowRight: '', Home: '', End: '' };

const pause = (ms) => new Promise((settle) => setTimeout(settle, ms));
let session = null;

async function wd(method, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await response.json();
  if (json.value?.error) throw new Error(`${method} ${path}: ${json.value.message}`);
  return json.value;
}
const at = (path) => `/session/${session}${path}`;
let loaded = '';
/**
 * Loads a fixture only when the route changes, then waits: VoiceOver reads a freshly loaded page
 * aloud and, with keyboard focus following its cursor, would otherwise move focus mid-scenario.
 * The same route is reused through its fixture API instead of a reload.
 */
async function go(route) {
  if (route === loaded) {
    await js(`window.accessibilityFixture?.reset(); window.attentionFixture?.clear(); document.activeElement?.blur?.()`);
    return;
  }
  await wd('POST', at('/url'), { url: base + route });
  loaded = route;
  await pause(Number(values.settle));
}
const js = (script, ...args) => wd('POST', at('/execute/sync'), { script, args });
const press = (key) => wd('POST', at('/actions'), {
  actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: KEYS[key] }, { type: 'keyUp', value: KEYS[key] }] }],
});
/** What the keyboard focus is on, as a short label. */
const focused = () => js(`const e = document.activeElement;
  if (!e || e === document.body) return 'body';
  return (e.tagName.toLowerCase() + ' ' + (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\\s+/g, ' ')).slice(0, 90);`);
/** Focuses the first element matching a selector, optionally with exact text; VoiceOver follows keyboard focus. */
const focus = (selector, text) => js(`const found = [...document.querySelectorAll(arguments[0])]
  .find(e => arguments[1] === null || e.textContent.trim() === arguments[1]);
  if (!found) throw new Error('Not found: ' + arguments[0] + ' ' + arguments[1]);
  found.focus(); return true;`, selector, text ?? null);

/** Opens the Island from the pill unless an auto-open already did. */
async function openIsland(scenario) {
  const pill = await js('return Boolean(document.querySelector("[data-cloudlet-pill]"))');
  if (!pill) return note(scenario, 'Island already open (auto-open), pill skipped', await focused());
  await step(scenario, 'focus the pill, Enter', async () => { await focus('[data-cloudlet-pill]'); await press('Enter'); });
}

async function step(scenario, label, action) {
  await appendFile(stepsFile, `${JSON.stringify({ at: new Date().toISOString(), scenario, step: label })}\n`);
  await action();
  await pause(SPEAK);
  const focus = await focused();
  await appendFile(stepsFile, `${JSON.stringify({ at: new Date().toISOString(), scenario, step: label, done: true, focus })}\n`);
  console.log(`${scenario.padEnd(12)} ${label.padEnd(44)} focus: ${focus}`);
}
const note = (scenario, label, value) => appendFile(stepsFile, `${JSON.stringify({ at: new Date().toISOString(), scenario, step: label, value })}\n`);

const clearButton = () => focus('button', 'Очистить уведомления');

const scenarios = {
  arrival: async (name) => {
    await step(name, 'load accessibility fixture', () => go('?fixture=accessibility'));
    await step(name, 'focus «Очистить уведомления»', clearButton);
    await step(name, 'first record arrives (focus must stay)', () => js(`window.accessibilityFixture.show({ id: 'a', title: 'Первое уведомление' })`));
    await step(name, 'second and third arrive', () => js(`window.accessibilityFixture.show({ id: 'b', title: 'Второе уведомление' });
      window.accessibilityFixture.show({ id: 'c', title: 'Третье уведомление' })`));
    await step(name, 'focus the pill', () => focus('[data-cloudlet-pill]'));
  },
  'pill-island': async (name) => {
    await step(name, 'load accessibility fixture', () => go('?fixture=accessibility'));
    await step(name, 'focus «Три уведомления», Enter', async () => { await focus('button', 'Три уведомления'); await press('Enter'); });
    await step(name, 'focus the pill', () => focus('[data-cloudlet-pill]'));
    await step(name, 'Enter on the pill', () => press('Enter'));
  },
  slider: async (name) => {
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'End', 'Home']) await step(name, key, () => press(key));
    await step(name, 'dot 2, Enter', async () => { await focus('.cloudlet-dot-button:nth-of-type(2)'); await press('Enter'); });
  },
  close: async (name) => {
    await step(name, 'focus close', () => focus('[data-cloudlet-control="close"]'));
    for (const count of [1, 2, 3]) await step(name, `Enter on close (${count} of 3)`, () => press('Enter'));
  },
  escape: async (name) => {
    await step(name, 'focus «Три уведомления», Enter', async () => { await focus('button', 'Три уведомления'); await press('Enter'); });
    await step(name, 'focus the pill, Enter', async () => { await focus('[data-cloudlet-pill]'); await press('Enter'); });
    await step(name, 'Escape', () => press('Escape'));
  },
  attention: async (name) => {
    await step(name, 'load attention fixture', () => go('?fixture=attention&delay=600'));
    for (const label of ['auto + описание', 'auto + действие', 'open без ничего']) {
      await step(name, `«${label}», Enter (focus must stay)`, async () => { await focus('button', label); await press('Enter'); });
      await pause(1500);
      await note(name, `after auto-open of «${label}»`, await focused());
      await js('window.attentionFixture.clear()');
    }
  },
  action: async (name) => {
    await step(name, 'load accessibility fixture', () => go('?fixture=accessibility'));
    await step(name, '«Проверить действие», Enter', async () => { await focus('button', 'Проверить действие'); await press('Enter'); });
    await openIsland(name);
    await step(name, 'focus «Сохранить», Enter (pending)', async () => { await focus('[data-cloudlet-control="action"]'); await press('Enter'); });
    await step(name, 'action fails', () => js('window.accessibilityFixture.settleAction(false)'));
    await step(name, 'focus «Сохранить», Enter (retry)', async () => { await focus('[data-cloudlet-control="action"]'); await press('Enter'); });
    await step(name, 'action succeeds', () => js('window.accessibilityFixture.settleAction(true)'));
  },
  operation: async (name) => {
    await step(name, 'load accessibility fixture', () => go('?fixture=accessibility'));
    await step(name, '«Проверить операцию», Enter', async () => { await focus('button', 'Проверить операцию'); await press('Enter'); });
    await openIsland(name);
    await step(name, 'attempt fails', () => js('window.accessibilityFixture.settleOperation(false)'));
    await step(name, 'focus «Повторить», Enter', async () => { await focus('[data-cloudlet-control="retry"]'); await press('Enter'); });
    await step(name, 'focus «Запросить отмену», Enter', async () => { await focus('[data-cloudlet-control="cancel"]'); await press('Enter'); });
    await step(name, 'cancelled attempt settles', () => js('window.accessibilityFixture.settleOperation(false)'));
    await step(name, 'focus «Повторить», Enter', async () => { await focus('[data-cloudlet-control="retry"]'); await press('Enter'); });
    await step(name, 'attempt succeeds', () => js('window.accessibilityFixture.settleOperation(true)'));
    await note(name, 'Retry button after success', await js('return document.querySelector(\'[data-cloudlet-control="retry"]\') ? "present" : "absent"'));
  },
  link: async (name) => {
    await step(name, 'load accessibility fixture', () => go('?fixture=accessibility'));
    await step(name, 'one record with a link', () => js(`window.accessibilityFixture.reset([{ id: 'link', title: 'Отчёт готов',
      action: { kind: 'link', label: 'Открыть отчёт', href: '#accessibility-destination' } }])`));
    await openIsland(name);
    await step(name, 'focus «Открыть отчёт»', () => focus('[data-cloudlet-control="action"]'));
    await step(name, 'Enter on the link', () => press('Enter'));
    await note(name, 'after the link', await js('return { hash: location.hash, records: window.accessibilityFixture.snapshot().stack.length }'));
  },
  overflow: async (name) => {
    await step(name, 'load accessibility fixture', () => go('?fixture=accessibility'));
    await step(name, 'focus «Очистить уведомления»', clearButton);
    await step(name, '101 records (one over the cap)', () => js(`for (let i = 0; i < 101; i++) window.accessibilityFixture.show({ id: 'o' + i, title: 'Запись ' + i })`));
    await step(name, 'focus the pill', () => focus('[data-cloudlet-pill]'));
    await step(name, 'Enter on the pill', () => press('Enter'));
    await step(name, 'focus «Подтвердить пропущенные», Enter', async () => { await focus('.cloudlet-overflow button'); await press('Enter'); });
  },
  hidden: async (name) => {
    await step(name, 'load accessibility fixture', () => go('?fixture=accessibility'));
    await step(name, 'one record, focus the page', async () => {
      await js(`window.accessibilityFixture.reset([{ id: 'x', title: 'Первое' }])`);
      await clearButton();
    });
    const original = await wd('GET', at('/window'));
    await step(name, 'another tab; a record arrives while this one is hidden', async () => {
      await js(`setTimeout(() => window.accessibilityFixture.show({ id: 'h', title: 'Пока вкладка скрыта' }), 1500)`);
      const { handle } = await wd('POST', at('/window/new'), { type: 'tab' });
      await wd('POST', at('/window'), { handle });
      await pause(4000);
      await wd('DELETE', at('/window'));
      await wd('POST', at('/window'), { handle: original });
    });
    await note(name, 'back on the stand', await js('return { visibility: document.visibilityState, records: window.accessibilityFixture.snapshot().stack.length }'));
  },
  'long-body': async (name) => {
    const rect = await wd('GET', at('/window/rect'));
    await wd('POST', at('/window/rect'), { width: 420, height: 820 });
    try {
      await step(name, 'load surface fixture (narrow window)', () => go('?surface'));
      await step(name, '«Длинный текст», Enter', async () => { await focus('button', 'Длинный текст'); await press('Enter'); });
      await step(name, 'open the Island, focus the title', async () => {
        await js('window.surfaceFixture.open()');
        await pause(800);
        await focus('[data-cloudlet-title]');
      });
      await note(name, 'body scrolls', await js(`const b = document.querySelector('.cloudlet-body');
        return b ? { scrolls: b.scrollHeight > b.clientHeight, tabindex: b.getAttribute('tabindex') } : null;`));
      await step(name, 'Tab from the title (onto the body)', () => press('Tab'));
      await step(name, 'End on the body', () => press('End'));
      await note(name, 'body scrollTop after End', await js('return document.querySelector(".cloudlet-body")?.scrollTop ?? null'));
    } finally {
      await wd('POST', at('/window/rect'), { width: rect.width, height: rect.height });
    }
  },
};

const selected = values.only ? values.only.split(',') : Object.keys(scenarios);
for (const name of selected) if (!scenarios[name]) throw new Error(`Unknown scenario ${name}; known: ${Object.keys(scenarios).join(', ')}`);

const children = [];
async function main() {
  await mkdir(dir, { recursive: true });
  const driver = spawn('safaridriver', ['-p', String(port)], { stdio: 'ignore' });
  children.push(driver);
  for (let attempt = 0; ; attempt += 1) {
    try { if ((await wd('GET', '/status')).ready !== undefined) break; } catch { /* not listening yet */ }
    if (attempt > 50) throw new Error('safaridriver did not start');
    await pause(200);
  }
  // Fast polling: a phrase cut short by the next one (the fixture's live status) still gets logged.
  const logger = spawn(process.execPath, ['scripts/voiceover-log.mjs', '--out', speechFile, '--interval', '50'], { stdio: ['ignore', 'ignore', 'inherit'] });
  children.push(logger);
  await pause(1500);
  ({ sessionId: session } = await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } }));
  for (const name of selected) await scenarios[name](name);
}

try {
  await main();
  console.log(`\nSpeech: ${speechFile}\nSteps:  ${stepsFile}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (session) await wd('DELETE', at('')).catch(() => {});
  for (const child of children.reverse()) child.kill('SIGTERM');
}
