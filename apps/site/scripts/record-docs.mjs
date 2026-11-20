#!/usr/bin/env node
/**
 * Walks /docs/components/toaster in headless Chromium against the static export: every page of
 * the sidebar opens with a clean console, the drawer and the table of contents work, Copy copies
 * the example, and axe finds no violations with the drawer closed and open. The component page:
 * the tabs of its Installation switch from the keyboard and copy their example, its Preview shows
 * one notification and five on the page Toaster (top on desktop, bottom on phones:
 * `position="auto"`), its Position, Side and Direction move that Toaster with the code under them,
 * from the mouse and the keyboard, Auto keeps the Side at Center with Left and Right off, Examples run where they put it and leaving the page resets it,
 * and its Examples run the whole catalog. Guides: every demo button of the
 * component page, Notifications, Operations and Forms shows its own
 * toast; in a group the pressed button selects the snippet under the stage; a long snippet unfolds
 * under Show code.
 * The color picker's page: every live example answers the keyboard in place and copies the code
 * under it, axe is clean and the page never scrolls sideways.
 * Styling and the advanced pages (Positioning, SSR, CSP, Accessibility) pass axe, the page never scrolls sideways, and every table wider
 * than the column scrolls inside itself. Style editor: the stage frame shows a
 * pinned pill and an open Island that stays open while the controls are pressed, the radius control
 * and the morphing color picker change the computed CSS and copied stylesheet for the site theme,
 * Copy link shares the current URL, a new tab restores it, an old `theme=` link is a foreign
 * parameter, Reset preserves foreign parameters, and Back skips intermediate edits. An editor
 * screenshot and axe audit per scenario cover light/dark × desktop/phone.
 * Reference:
 * the five pages keep every section other pages link to and have no Next steps, fit the width
 * (rows of three or more columns are a grid line with the description
 * under it, every row a card on phones), every link to a docs anchor lands on
 * an existing heading, and axe is clean. Search and agents: the search window opens from its
 * button, ⌘K / Ctrl K and `/` (not on the landings, `/` stays a character in the
 * field), a word from Accessibility finds the page and Enter opens it, arrows move, there is an
 * empty and a no-result state, Escape closes and gives the focus back, axe is clean with it open;
 * the drawer opens and closes from the keyboard; `/llms.txt`, `/llms-full.txt` and the `.md` of a
 * page are served.
 *
 *   npm run build && npm run build:site
 *   node apps/site/scripts/record-docs.mjs <out-dir> [scenario ...]
 *
 * Writes a PNG per step, a video per scenario and report.json; exits 1 on any failure.
 */
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { serve } from './serve-out.mjs';

const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const SCENARIOS = {
  'desktop-light': { context: { ...DESKTOP, colorScheme: 'light' } },
  'desktop-dark': { context: { ...DESKTOP, colorScheme: 'dark' } },
  'mobile-light': { context: { ...PHONE, colorScheme: 'light' } },
  'mobile-dark': { context: { ...PHONE, colorScheme: 'dark' } },
};

const wait = (page, ms) => page.waitForTimeout(ms);

/** The component page's sections and its Examples groups (DEMO_GROUPS), as table-of-contents links. */
const TOC_ENTRIES = ['preview', 'installation', 'usage', 'examples', 'kinds', 'content', 'actions', 'forms', 'promises', 'attention', 'stack', 'api-reference'].map((id) => `#${id}`);

/** What the page Toaster shows: edge, state and the visible titles. */
async function toaster(page) {
  return page.evaluate(() => {
    const host = document.querySelector('.cloudlet-host');
    const visible = (element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
    };
    return {
      edge: host?.getAttribute('data-edge') ?? null,
      state: host?.getAttribute('data-state') ?? null,
      pill: host?.querySelector('.cloudlet-pill')?.getAttribute('aria-label') ?? null,
      titles: [...(host?.querySelectorAll('.cloudlet-title') ?? [])].filter(visible).map((title) => title.textContent?.trim() ?? ''),
    };
  });
}

/** Copies a code block with its Copy button and compares the clipboard with the block's text. */
async function copyBlock(page, figure) {
  await figure.scrollIntoViewIfNeeded();
  // The button of the code bar by its class: a color picker on the stage has a Copy button of its own.
  await figure.locator('.docs-code-button').click();
  await wait(page, 300);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const source = await figure.locator('pre').evaluate((pre) => pre.textContent?.replace(/\n$/u, '') ?? '');
  return { ok: copied === source && copied.length > 0, length: copied.length, label: await figure.locator('.docs-code-title').textContent() };
}

/** Installation of the component page: npm / shadcn tabs from the keyboard, each tab's example copies verbatim. */
async function installation(page, base, still, failures) {
  await page.goto(`${base}/docs/components/toaster#installation`);
  await wait(page, 600);
  await still('installation');
  const result = { axe: await axe(page), tabs: [] };
  const tabs = page.getByRole('tab');
  await tabs.first().focus();
  for (const key of [null, 'ArrowRight', 'ArrowRight']) {
    if (key) await page.keyboard.press(key);
    await wait(page, 250);
    const selected = await page.locator('[role="tab"][aria-selected="true"]').textContent();
    const focused = await page.evaluate(() => document.activeElement?.textContent ?? '');
    const blocks = page.locator('[role="tabpanel"] .docs-code');
    const copy = await copyBlock(page, blocks.last());
    result.tabs.push({ key, selected, focused, blocks: await blocks.count(), copy });
    if (selected !== focused || (await blocks.count()) !== 2 || !copy.ok) failures.push(`installation tab ${key}: ${JSON.stringify(result.tabs.at(-1))}`);
    await tabs.first().scrollIntoViewIfNeeded();
    await page.locator('[role="tab"][aria-selected="true"]').focus();
  }
  // → moves npm → shadcn → npm (wraps).
  const order = result.tabs.map((tab) => tab.selected);
  if (order.join(',') !== 'npm,shadcn,npm') failures.push(`installation tab order: ${order}`);
  await page.getByRole('tab', { name: 'shadcn' }).click();
  await wait(page, 300);
  await still('installation-shadcn');
  return result;
}

/** The page's own Toaster (not a Toaster inside the article, as the Style editor has): where it sits. */
async function pageHost(page) {
  return page.evaluate(() => {
    const host = [...document.querySelectorAll('.cloudlet-host')].find((element) => !element.closest('article'));
    return { position: host?.dataset.position ?? null, edge: host?.dataset.edge ?? null, align: host?.dataset.align ?? null, dir: host?.getAttribute('dir') ?? null };
  });
}

/** The code the Preview shows for a setting: `<Toaster />` with the props off their defaults. */
const toasterCode = (position, dir) => `<Toaster${position === 'auto' ? '' : ` position="${position}"`}${dir === 'ltr' ? '' : ` dir="${dir}"`} />`;

/**
 * Preview of the component page, the live page Toaster: its two buttons are enabled after mount
 * and show one notification and five; every control moves the page Toaster (`data-position`,
 * `data-edge`, `data-align` and `dir` of its host) and the code under them follows and copies
 * verbatim; a Run of the Examples lands where the controls put it; Tab goes button, button, the
 * three radio groups (arrows move inside), the Styling link, Copy, the code; Auto takes the Side to
 * Center and turns Left and Right off (neither a click nor an arrow reaches them), Top and Bottom
 * take every side, and the code is `<Toaster />` on Auto at any width; with reduced motion
 * the code swaps without its fade and the stack moves at once; leaving the page puts the Toaster
 * back to `auto`, and coming back starts the controls at their defaults.
 */
async function preview(page, base, phone, still, failures) {
  // A fresh document: after the Installation scenario a goto to #preview would be a fragment
  // navigation, a history entry the app router never wrote, and Back to it leaves Styling on screen.
  await page.goto('about:blank');
  await page.goto(`${base}/docs/components/toaster#preview`);
  await wait(page, 600);
  await still('preview');
  const fail = (step, value) => failures.push(`preview ${step}: ${JSON.stringify(value)}`);
  const result = { axe: { page: await axe(page) }, steps: [] };
  const figure = page.locator('.docs-preview');
  const one = figure.locator('[data-preview="one"]');
  const five = figure.locator('[data-preview="five"]');
  const code = () => figure.locator('pre').evaluate((pre) => pre.textContent ?? '');
  // Mid-screen before every press: on a phone the stack sits at the bottom, over whatever is under it.
  const press = async (locator) => {
    await locator.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await locator.click();
  };
  const pick = async (group, option) => {
    await press(figure.getByRole('group', { name: group, exact: true }).getByText(option, { exact: true }));
    await wait(page, 300);
  };
  // position="auto": the top edge on a desktop, the bottom one on a phone.
  const auto = phone ? 'bottom' : 'top';

  // The page says once what the snippets assume, above the first demo block of the Examples.
  result.note = await page.locator('.docs-demo-note').count();
  result.enabled = (await one.isEnabled()) && (await five.isEnabled());
  result.initial = { code: await code(), host: await pageHost(page) };
  if (result.note !== 1 || !result.enabled) fail('buttons', result);
  if (result.initial.code !== '<Toaster />' || result.initial.host.position !== 'auto' || result.initial.host.edge !== auto || result.initial.host.dir !== 'ltr') fail('defaults', result.initial);

  // Keyboard: Tab reaches every control once, a radio group by its checked option.
  await one.focus();
  const path = [];
  for (let step = 0; step < 8; step += 1) {
    path.push(await page.evaluate(() => {
      const element = document.activeElement;
      if (!element) return null;
      if (element.matches('[data-preview]')) return element.getAttribute('data-preview');
      if (element.matches('input[type="radio"]')) return `radio:${element.value}`;
      if (element.matches('a')) return `link:${element.textContent}`;
      if (element.matches('button')) return `button:${element.getAttribute('aria-label')}`;
      return element.tagName.toLowerCase();
    }));
    await page.keyboard.press('Tab');
  }
  result.tab = path;
  const expectedPath = ['one', 'five', 'radio:auto', 'radio:center', 'radio:ltr', 'link:Customize the look', 'button:Copy Toaster', 'pre'];
  if (path.join(',') !== expectedPath.join(',')) fail('tab path', path);
  // Arrows move inside a group and move the Toaster with it.
  await figure.locator('input[value="auto"]').focus();
  await page.keyboard.press('ArrowRight');
  await wait(page, 300);
  result.arrow = { checked: await figure.locator('fieldset:has(input[value="auto"]) input:checked').getAttribute('value'), host: await pageHost(page), code: await code() };
  await page.keyboard.press('ArrowLeft');
  await wait(page, 300);
  if (result.arrow.checked !== 'top' || result.arrow.host.position !== 'top-center' || result.arrow.code !== toasterCode('top-center', 'ltr')) fail('arrows', result.arrow);
  if ((await pageHost(page)).position !== 'auto') fail('arrow back', await pageHost(page));

  await press(one);
  await wait(page, 1200);
  result.toast = await toaster(page);
  await still('run');
  result.axe.toast = await axe(page);
  if (result.toast.edge !== auto || !result.toast.titles.includes('Synced to the cloud')) fail('show a notification', result.toast);

  // Every control: the host and the code follow.
  const steps = [
    ['Position', 'Top', 'top-center', 'top', 'center', 'ltr'],
    ['Side', 'Left', 'top-left', 'top', 'left', 'ltr'],
    ['Side', 'Right', 'top-right', 'top', 'right', 'ltr'],
    ['Position', 'Bottom', 'bottom-right', 'bottom', 'right', 'ltr'],
    ['Direction', 'RTL', 'bottom-right', 'bottom', 'right', 'rtl'],
    // Auto from Right: the Side goes to Center.
    ['Position', 'Auto', 'auto', auto, 'center', 'rtl'],
    ['Direction', 'LTR', 'auto', auto, 'center', 'ltr'],
  ];
  for (const [group, option, position, edge, align, dir] of steps) {
    await pick(group, option);
    const step = { group, option, host: await pageHost(page), code: await code() };
    result.steps.push(step);
    const host = step.host;
    if (host.position !== position || host.edge !== edge || host.align !== align || host.dir !== dir || step.code !== toasterCode(position, dir)) fail(`${group} ${option}`, step);
    if (option === 'RTL') await still('preview-rtl');
  }

  // Auto lives in the centre: Left and Right are shown but off, a click on them and the arrows
  // inside the group leave Center checked and the Toaster at auto.
  const sideGroup = figure.getByRole('group', { name: 'Side', exact: true });
  const sides = () => sideGroup.locator('input').evaluateAll((inputs) => inputs.map((input) => `${input.value}${input.disabled ? ':off' : ''}${input.checked ? ':checked' : ''}`).join(','));
  result.auto = { sides: await sides() };
  // Forced: Playwright would wait for a disabled control to turn on; the browser drops the click.
  await sideGroup.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  for (const option of ['Left', 'Right']) await sideGroup.getByText(option, { exact: true }).click({ force: true });
  await wait(page, 300);
  result.auto.clicked = { sides: await sides(), host: await pageHost(page), code: await code() };
  await sideGroup.locator('input[value="center"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await wait(page, 300);
  result.auto.arrows = { sides: await sides(), host: await pageHost(page), focused: await page.evaluate(() => (document.activeElement instanceof HTMLInputElement ? document.activeElement.value : null)) };
  await still('preview-auto');
  const centred = 'left:off,center:checked,right:off';
  if (result.auto.sides !== centred || result.auto.clicked.sides !== centred || result.auto.clicked.host.position !== 'auto' || result.auto.clicked.code !== '<Toaster />') fail('auto sides', result.auto);
  if (result.auto.arrows.sides !== centred || result.auto.arrows.focused !== 'center' || result.auto.arrows.host.position !== 'auto') fail('auto arrows', result.auto.arrows);
  // Top frees every side again.
  await pick('Position', 'Top');
  result.auto.top = await sides();
  if (result.auto.top !== 'left,center:checked,right') fail('top sides', result.auto.top);

  // Five notifications in a corner; the code copies as shown.
  await pick('Position', 'Top');
  await pick('Side', 'Left');
  // An empty stack first: the notification shown above leaves on its timer, so the count after the
  // press is this button's own.
  await page.waitForFunction(() => !document.querySelector('.cloudlet-host .cloudlet-pill'), null, { timeout: 15000 }).catch(() => {});
  const before = (await toaster(page)).pill;
  await press(five);
  await wait(page, 1200);
  result.five = { ...(await toaster(page)), host: await pageHost(page), before };
  await still('preview-five');
  // The pill names how many are stacked: exactly five.
  result.five.stacked = Number(/(\d+) notifications/u.exec(result.five.pill ?? '')?.[1] ?? 0);
  if (before !== null || result.five.host.align !== 'left' || result.five.edge !== 'top' || !result.five.titles.includes('Altocumulus drifted by') || result.five.stacked !== 5) fail('show five', result.five);
  result.copy = await copyBlock(page, figure);
  if (!result.copy.ok || (await code()) !== toasterCode('top-left', 'ltr')) fail('copy', result.copy);

  // A Run of the Examples lands where the Preview put the Toaster.
  await pick('Position', 'Bottom');
  const run = page.locator('.docs-demo:not(.docs-preview) .docs-demo-trigger[data-demo="error"]').first();
  await press(run);
  await wait(page, 1200);
  result.examples = await toaster(page);
  result.examples.host = await pageHost(page);
  await still('preview-examples');
  if (result.examples.edge !== 'bottom' || result.examples.host.align !== 'left' || !result.examples.titles.includes('Sync got lost in the fog')) fail('run in Examples', result.examples);

  // Reduced motion: the new code is there without its fade, the stack is already on its side.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await press(figure.getByRole('group', { name: 'Side', exact: true }).getByText('Right', { exact: true }));
  // A render and an effect later; nothing of either moves (a fade would still run its 220 ms).
  await wait(page, 150);
  result.reduced = await page.evaluate(() => {
    const pre = document.querySelector('.docs-preview pre');
    const host = [...document.querySelectorAll('.cloudlet-host')].find((element) => !element.closest('article'));
    return { animation: pre ? getComputedStyle(pre).animationName : null, align: host?.dataset.align ?? null };
  });
  await page.emulateMedia({ reducedMotion: null });
  if (result.reduced.animation !== 'none' || result.reduced.align !== 'right') fail('reduced motion', result.reduced);

  // Leaving the page (a client-side link) puts the Toaster back; coming back resets the controls.
  await press(figure.getByRole('link', { name: 'Customize the look' }));
  await page.waitForURL('**/docs/components/toaster/styling');
  await wait(page, 600);
  result.left = await pageHost(page);
  await page.goBack();
  await page.waitForURL((url) => url.pathname === '/docs/components/toaster');
  await wait(page, 600);
  result.back = { checked: await figure.locator('input:checked').evaluateAll((inputs) => inputs.map((input) => input.value)), code: await code(), host: await pageHost(page) };
  if (result.left.position !== 'auto' || result.left.dir !== 'ltr') fail('leave', result.left);
  if (result.back.checked.join(',') !== 'auto,center,ltr' || result.back.code !== '<Toaster />' || result.back.host.position !== 'auto') fail('back', result.back);
  return result;
}

/** The color picker's page in the docs. */
const PICKER_PAGE = '/docs/components/color-picker';

/**
 * A live example of a page: the component on its stage answers the keyboard in place (the hue
 * slider of its picker moves and the value follows), and Copy gives the code under it.
 */
async function liveExample(page, name, failures) {
  const figure = page.locator(`[data-example="${name}"]`);
  const entry = { name, shown: (await figure.count()) === 1 };
  if (!entry.shown) {
    failures.push(`example ${name}: not on the page`);
    return entry;
  }
  await figure.scrollIntoViewIfNeeded();
  const stage = figure.locator('.docs-demo-stage');
  const value = () => stage.locator('.color-picker-value').first().inputValue();
  const before = await value();
  await stage.getByRole('slider', { name: 'Hue' }).first().focus();
  await page.keyboard.press('Shift+ArrowRight');
  await wait(page, 150);
  entry.value = { before, after: await value() };
  if (entry.value.after === before) failures.push(`example ${name}: the hue slider did not change ${before}`);
  entry.copy = await copyBlock(page, figure);
  if (!entry.copy.ok) failures.push(`example ${name}: Copy gave ${entry.copy.length} characters, not the code shown`);
  return entry;
}

/** The color picker's page: its live examples work in place and copy their code; axe; no sideways scroll. */
async function pickerPage(page, base, still, failures) {
  await page.goto(`${base}${PICKER_PAGE}`);
  await wait(page, 600);
  const result = { examples: [] };
  for (const name of await page.locator('[data-example]').evaluateAll((figures) => figures.map((figure) => figure.getAttribute('data-example')))) {
    result.examples.push(await liveExample(page, name, failures));
  }
  if (!result.examples.length) failures.push('color picker page: no live example');
  await still('picker-example');
  result.sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (result.sideways > 0) failures.push(`color picker page scrolls sideways by ${result.sideways}px`);
  await page.evaluate(() => window.scrollTo(0, 0));
  result.axe = await axe(page);
  return result;
}

/** Pages whose every demo button is checked (`''` is the component page); a fresh load per demo, so each toast is its own. */
const GUIDES = ['', 'notifications', 'operations', 'forms'];

/**
 * Guides: each demo button shows a notification titled as its snippet; `dismiss-all` empties the
 * stack after `overflow`. Then the demo blocks themselves: in a group every button selects
 * its snippet and the page does not jump; a folded snippet unfolds under Show code.
 */
async function guides(page, base, still, failures) {
  const result = {};
  for (const slug of GUIDES) {
    const url = `${base}/docs/components/toaster${slug && `/${slug}`}`;
    const name = slug || 'toaster';
    await page.goto(url);
    await wait(page, 600);
    await page.screenshot({ path: still.path(`full-${name}`), fullPage: true });
    const entry = { axe: { page: await axe(page) }, runs: [], groups: [], folds: [] };
    // By block and button, not by id: the same demo may run from two blocks of a page.
    const buttons = await page.locator('.docs-demo').evaluateAll((blocks) =>
      blocks.flatMap((block, at) => [...block.querySelectorAll('.docs-demo-trigger[data-demo]')].map((button, index) => ({ at, index, id: button.getAttribute('data-demo') }))),
    );
    for (const [run, { at, index, id }] of buttons.entries()) {
      // dismiss-all clears what the demo before it (overflow) left; every other demo starts from an empty stack.
      if (id !== 'dismiss-all') {
        await page.goto(url);
        await wait(page, 600);
      }
      const figure = page.locator('.docs-demo').nth(at);
      const trigger = figure.locator('.docs-demo-trigger').nth(index);
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      await wait(page, 900);
      // The pressed button's figure now shows its snippet (data-demo follows the selection).
      const source = await figure.locator('pre').evaluate((pre) => pre.textContent ?? '');
      // The first title of the snippet; of a template literal, its longest literal part (`${name} drifted by`).
      const title = /title: (['"`])(.*?)\1/u.exec(source)?.[2] ?? '';
      const expected = title.split(/\$\{[^}]*\}/u).map((part) => part.trim()).sort((a, b) => b.length - a.length)[0] || null;
      const toast = await toaster(page);
      const shown = [toast.pill ?? '', ...toast.titles].join(' | ');
      const ok = id === 'dismiss-all' ? toast.pill === null && toast.titles.length === 0 : Boolean(expected) && shown.includes(expected);
      entry.runs.push({ id, expected, shown, ok });
      if (!ok) failures.push(`run ${name} ${id}: expected "${expected}", shown "${shown}"`);
      if (run === 0) {
        await still(`run-${name}`);
        entry.axe.toast = await axe(page);
      }
    }
    await page.goto(url);
    await wait(page, 600);
    entry.groups = await groups(page, name, still, failures);
    entry.folds = await folds(page, name, still, failures);
    result[name] = entry;
  }
  return result;
}

/** Every grouped demo block of the page: pressing a button selects its snippet, the current mark follows, the page stays put. */
async function groups(page, slug, still, failures) {
  const checks = [];
  const blocks = page.locator('.docs-demo[data-group]');
  for (let index = 0; index < (await blocks.count()); index += 1) {
    const block = blocks.nth(index);
    await block.scrollIntoViewIfNeeded();
    const buttons = block.locator('.docs-demo-trigger');
    for (let button = 0; button < (await buttons.count()); button += 1) {
      const id = await buttons.nth(button).getAttribute('data-demo');
      const before = await page.evaluate(() => window.scrollY);
      await buttons.nth(button).click();
      await wait(page, 500);
      const check = {
        id,
        title: await block.locator('.docs-code-title').textContent(),
        current: await block.locator('.docs-demo-trigger[aria-current="true"]').getAttribute('data-demo'),
        jumped: Math.abs((await page.evaluate(() => window.scrollY)) - before) > 1,
      };
      checks.push(check);
      if (check.title !== id || check.current !== id || check.jumped) failures.push(`group ${slug} ${id}: ${JSON.stringify(check)}`);
      if (index === 0 && button === 1) await still(`group-${slug}`);
    }
  }
  return checks;
}

/** The first folded snippet of the page unfolds under Show code and folds back under Hide code. */
async function folds(page, slug, still, failures) {
  // Element handles, not locators: the fold attribute the block is found by goes away once it unfolds.
  const block = await page.locator('.docs-demo:has(.docs-demo-code[data-folded])').first().elementHandle({ timeout: 2000 }).catch(() => null);
  if (!block) return [];
  await block.scrollIntoViewIfNeeded();
  const area = await block.$('.docs-demo-code');
  const button = await area.$('.docs-demo-fold');
  const id = await block.getAttribute('data-demo');
  const check = { id, label: await button.textContent(), shown: await button.getAttribute('aria-expanded') };
  await still(`fold-${slug}`);
  await button.click();
  await wait(page, 500);
  check.expanded = (await area.getAttribute('data-folded')) === null;
  check.hide = await button.textContent();
  check.hideExpanded = await button.getAttribute('aria-expanded');
  await still(`unfold-${slug}`);
  await button.click();
  await wait(page, 500);
  check.foldedAgain = (await area.getAttribute('data-folded')) !== null;
  const ok = check.label === 'Show code' && check.shown === 'false' && check.expanded && check.hide === 'Hide code' && check.hideExpanded === 'true' && check.foldedAgain;
  if (!ok) failures.push(`fold ${slug}: ${JSON.stringify(check)}`);
  return [check];
}

const INTEGRATION = ['styling', 'positioning', 'ssr', 'csp', 'accessibility'];

/** Styling's editor: a stage frame with a pinned pill and an open Island, real CSSOM, clipboard and URL behaviour. */
async function styleEditor(page, base, still, failures, previousUrl) {
  const editor = page.locator('.docs-style-editor');
  const radius = editor.getByRole('slider', { name: 'Pill radius', exact: true });
  const swatch = editor.getByRole('button', { name: 'Pick background color', exact: true });
  // The preview follows the site theme, so this scenario edits that theme's colors.
  const theme = await page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  const surfaceParam = theme === 'dark' ? 'background-dark' : 'background';
  const before = await page.evaluate(() => ({ length: history.length, pathname: location.pathname, hash: location.hash }));
  const result = { axe: {}, theme };
  const fail = (step, detail) => failures.push(`style editor ${step}: ${JSON.stringify(detail)}`);
  /** The two hosts inside the stage frame: state, theme and the computed tokens under test. */
  const stage = (target = page) => target.evaluate(() => {
    const doc = document.querySelector('iframe.docs-style-frame')?.contentDocument;
    const read = (zone) => {
      const host = doc?.querySelector(`[data-zone="${zone}"] .cloudlet-host`);
      const body = host?.querySelector('.cloudlet-slide > .cloudlet-body');
      const style = host && getComputedStyle(host);
      return host ? {
        state: host.getAttribute('data-state'), theme: host.getAttribute('data-theme'),
        settled: !body || Number(getComputedStyle(body).opacity) > .99,
        radius: style.getPropertyValue('--cloudlet-pill-radius').trim(), background: style.getPropertyValue('--cloudlet-background').trim(),
      } : null;
    };
    return { pill: read('pill'), island: read('island') };
  });
  const islandOpen = (target = page) => target.waitForFunction(() => {
    const host = document.querySelector('iframe.docs-style-frame')?.contentDocument?.querySelector('[data-zone="island"] .cloudlet-host');
    const body = host?.querySelector('.cloudlet-slide > .cloudlet-body');
    return host?.getAttribute('data-state') === 'island' && body && Number(getComputedStyle(body).opacity) > .99;
  });

  // Nothing to trigger: the pill and the Island are there from the first frame.
  await islandOpen();
  result.shapes = await stage();
  if (result.shapes.pill?.state !== 'stack' || result.shapes.island?.state !== 'island' || result.shapes.island.theme !== theme) fail('shapes', result.shapes);

  // Native range keyboard input exercises the slider without assigning DOM values; a pointer
  // press on the controls must leave the Island open (they are outside the stage document).
  await editor.getByText('Island radius', { exact: true }).click();
  await radius.focus();
  await page.keyboard.press('Home');
  for (let step = 0; step < 4; step++) await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('iframe.docs-style-frame').contentDocument.querySelector('.cloudlet-host')).getPropertyValue('--cloudlet-pill-radius').trim() === '12px');
  await page.waitForURL((url) => url.searchParams.get('pill-radius') === '12px');
  const shaped = await stage();
  result.radius = { slider: await radius.inputValue(), pill: shaped.pill?.radius, island: shaped.island?.state };
  if (result.radius.slider !== '12' || result.radius.pill !== '12px' || result.radius.island !== 'island') fail('radius', result.radius);

  // The swatch opens the picker; the keyboard picks; Escape closes it back onto the swatch.
  await swatch.click();
  const picker = editor.getByRole('dialog', { name: 'Background color picker' });
  await picker.waitFor();
  await picker.getByRole('slider', { name: 'Saturation and brightness', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await picker.waitFor({ state: 'detached' });
  const picked = await editor.getByRole('textbox', { name: 'Background', exact: true }).inputValue();
  await page.waitForURL((url) => url.searchParams.get(surfaceParam) === picked);
  result.color = {
    picked, expanded: await swatch.getAttribute('aria-expanded'), focused: await swatch.evaluate((element) => element === document.activeElement),
    preview: (await stage()).island?.background, island: (await stage()).island?.state,
  };
  if (result.color.preview !== picked || result.color.expanded !== 'false' || !result.color.focused || result.color.island !== 'island') fail('color', result.color);
  result.url = page.url();

  await editor.getByRole('button', { name: 'Copy CSS', exact: true }).click();
  await page.waitForFunction(async () => (await navigator.clipboard.readText()).includes('--cloudlet-pill-radius: 12px;'));
  const css = await editor.locator('pre').textContent();
  const copiedCss = await page.evaluate(() => navigator.clipboard.readText());
  result.copyCss = copiedCss === css && copiedCss.includes(`--cloudlet-background: ${picked};`) && (theme === 'light' || copiedCss.includes('.cloudlet-host[data-theme="dark"]'));
  if (!result.copyCss) fail('Copy CSS', { copiedCss, css });
  await editor.getByRole('button', { name: 'Copy link', exact: true }).click();
  await page.waitForFunction(async () => (await navigator.clipboard.readText()) === location.href);
  const link = await page.evaluate(() => navigator.clipboard.readText());
  result.copyLink = link === page.url();
  if (!result.copyLink) fail('Copy link', { link, href: page.url() });

  await islandOpen();
  await editor.screenshot({
    path: still.path(`style-editor-${theme}`),
    // Hide overlapping sticky chrome only during this element capture.
    style: '.site-header, .site-edge, .docs-mobile-bar { visibility: hidden !important; }',
  });
  result.axe[theme] = await axe(page);

  // A new tab has no editor state to inherit: the copied URL is the complete contract.
  const fresh = await page.context().newPage();
  const freshConsole = [];
  fresh.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) freshConsole.push(`${message.type()}: ${message.text()}`);
  });
  fresh.on('pageerror', (error) => freshConsole.push(`pageerror: ${error.message}`));
  fresh.on('response', (response) => {
    if (response.status() >= 400) freshConsole.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  try {
    await fresh.goto(link);
    await fresh.waitForFunction(() => document.querySelector('.docs-style-editor input[type="range"][aria-valuetext="12px"]'));
    await islandOpen(fresh);
    const freshEditor = fresh.locator('.docs-style-editor');
    result.newTab = {
      radius: await freshEditor.getByRole('slider', { name: 'Pill radius', exact: true }).inputValue(),
      background: await freshEditor.getByRole('textbox', { name: 'Background', exact: true }).inputValue(),
      preview: (await stage(fresh)).island?.background,
      console: freshConsole,
    };
    if (result.newTab.radius !== '12' || result.newTab.background !== picked || result.newTab.preview !== picked || freshConsole.length) fail('new tab', result.newTab);
  } finally {
    await fresh.close();
  }

  await editor.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.waitForURL((url) => url.search === '?foo=1');
  result.reset = await page.evaluate(() => ({ length: history.length, pathname: location.pathname, search: location.search, hash: location.hash }));
  result.reset.emptyCss = (await editor.locator('pre').textContent()) === '/* Nothing changed yet */';
  result.reset.full = await radius.getAttribute('aria-valuetext') === 'Full';
  result.reset.island = (await stage()).island?.state;
  if (result.reset.length !== before.length || result.reset.pathname !== before.pathname || result.reset.hash !== before.hash || !result.reset.emptyCss || !result.reset.full || result.reset.island !== 'island') fail('Reset/history', { before, after: result.reset });
  await page.goBack();
  result.back = { expected: previousUrl, actual: page.url() };
  if (result.back.actual !== previousUrl) fail('Back', result.back);

  // Links from before the amendments carry theme=dark: it is now a foreign parameter, the preview keeps the site theme.
  await page.goto(`${base}/docs/components/toaster/styling?pill-radius=12px&theme=dark`);
  await page.waitForFunction(() => document.querySelector('.docs-style-editor input[type="range"][aria-valuetext="12px"]'));
  await islandOpen();
  result.oldLink = { radius: await radius.inputValue(), theme: (await stage()).island?.theme };
  if (result.oldLink.radius !== '12' || result.oldLink.theme !== theme) fail('old link', result.oldLink);
  await editor.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.waitForURL((url) => url.search === '?theme=dark');
  result.resetForeignQuery = new URL(page.url()).search;
  return result;
}

/** Styling and the advanced pages: no horizontal page scroll; a table wider than its column scrolls inside its own wrapper. */
async function integration(page, base, still, failures) {
  const result = {};
  for (const slug of INTEGRATION) {
    const previousUrl = page.url();
    await page.goto(`${base}/docs/components/toaster/${slug}${slug === 'styling' ? '?foo=1#style-editor' : ''}`);
    await wait(page, 600);
    await page.screenshot({ path: still.path(`full-${slug}`), fullPage: true });
    const layout = await page.evaluate(() => {
      const root = document.documentElement;
      const tables = [...document.querySelectorAll('.docs-table')].map((wrapper) => {
        const overflow = wrapper.scrollWidth - wrapper.clientWidth;
        wrapper.scrollLeft = overflow;
        const scrolled = wrapper.scrollLeft;
        wrapper.scrollLeft = 0;
        return { overflow, scrolled };
      });
      return { pageOverflow: root.scrollWidth - root.clientWidth, tables };
    });
    const wide = layout.tables.filter((table) => table.overflow > 0);
    const entry = { axe: await axe(page), pageOverflow: layout.pageOverflow, tables: layout.tables.length, wide: wide.length };
    if (layout.pageOverflow > 0) failures.push(`${slug}: page scrolls sideways by ${layout.pageOverflow}px`);
    if (wide.some((table) => table.scrolled === 0)) failures.push(`${slug}: a wide table does not scroll: ${JSON.stringify(wide)}`);
    if (wide.length) {
      // The first wide table, scrolled to its end: the columns stay readable inside the wrapper.
      const wrapper = page.locator('.docs-table').nth(layout.tables.findIndex((table) => table.overflow > 0));
      await wrapper.scrollIntoViewIfNeeded();
      await wrapper.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
      await wait(page, 200);
      await still(`table-${slug}`);
    }
    if (slug === 'styling') {
      entry.editor = await styleEditor(page, base, still, failures, previousUrl);
      for (const [theme, violations] of Object.entries(entry.editor.axe)) entry.axe.push(...violations.map((violation) => `editor ${theme}: ${violation}`));
    }
    result[slug] = entry;
  }
  return result;
}

/** Reference pages and the section ids other pages link to: each must still be a heading of its page. */
const REFERENCE = {
  'create-cloudlet': ['options', 'messages', 'onoverflow', 'ondiagnostic'],
  controller: ['show', 'admissionresult', 'update', 'mutationresult', 'gethandle', 'track', 'operationhandle', 'operationsnapshot', 'dismiss', 'clear', 'requestfocus', 'acknowledgeoverflow', 'getsnapshot-and-getserversnapshot', 'subscribe-and-onevent', 'dispose', 'notificationcontroller'],
  toaster: ['props', 'toasteroffsets', 'toasterattention', 'toastermotion', 'classnames', 'cloudletprovider', 'usecloudlet', 'useoptionalcloudlet'],
  labels: ['cloudletlabels', 'announcementformatters', 'controller-messages', 'a-complete-translation'],
  types: ['identity', 'notifications', 'description', 'progress', 'primaryaction', 'closereason', 'operations', 'snapshots', 'notificationsnapshot', 'events', 'controller', 'react'],
};

/** Reference: its sections, no Next steps, no sideways scrolling of the page or a table, card rows on phones, docs links land on a real id. */
async function reference(page, base, phone, still, failures) {
  const result = {};
  const ids = new Map();
  for (const [slug, sections] of Object.entries(REFERENCE)) {
    await page.goto(`${base}/docs/components/toaster/api/${slug}`);
    await wait(page, 600);
    await page.screenshot({ path: still.path(`full-api-${slug}`), fullPage: true });
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      scrollingTables: [...document.querySelectorAll('.docs-table')].filter((table) => table.scrollWidth > table.clientWidth + 1).length,
      tables: document.querySelectorAll('table[data-reference]').length,
      // A Prop · Type · Default · Description row: a card on phones, a grid line on wider screens.
      rows: getComputedStyle(document.querySelector('table[data-grid="4"] tbody tr') ?? document.body).display,
      links: [...document.querySelectorAll('article a[href^="/docs/components/toaster"], article a[href^="#"]')].map((link) => link.getAttribute('href') ?? ''),
      headings: [...document.querySelectorAll('article :is(h2, h3)')].map((heading) => heading.id),
    }));
    const missing = sections.filter((id) => !layout.headings.includes(id));
    const entry = { ...layout, links: layout.links.length, headings: layout.headings.length, missingSections: missing, axe: await axe(page), brokenLinks: [] };
    if (missing.length) failures.push(`reference ${slug}: sections without a heading ${missing.join(', ')}`);
    if (layout.headings.includes('next-steps')) failures.push(`reference ${slug}: a Next steps section repeats the sidebar`);
    if (entry.overflow > 0 || entry.scrollingTables > 0) failures.push(`reference ${slug}: overflow ${entry.overflow}px, ${entry.scrollingTables} scrolling tables`);
    if (entry.tables === 0 || entry.rows !== (phone ? 'block' : 'grid')) failures.push(`reference ${slug}: ${entry.tables} tables, rows ${entry.rows}`);
    for (const href of new Set(layout.links)) {
      const [path, hash] = href.startsWith('#') ? [`/docs/components/toaster/api/${slug}`, href.slice(1)] : href.split('#');
      if (!hash) continue;
      if (!ids.has(path)) {
        const html = await page.evaluate(async (url) => (await fetch(url)).text(), path);
        ids.set(path, new Set([...html.matchAll(/ id="([^"]+)"/gu)].map((match) => match[1])));
      }
      if (!ids.get(path).has(decodeURIComponent(hash))) entry.brokenLinks.push(href);
    }
    if (entry.brokenLinks.length) failures.push(`reference ${slug}: links without a target ${entry.brokenLinks.join(', ')}`);
    result[slug] = entry;
  }
  return result;
}

/** The word typed into the search, and the page it must find first. */
const SEARCH_QUERY = 'live region';
const SEARCH_PAGE = { name: 'Accessibility', path: '/docs/components/toaster/accessibility' };

/** The open search window, if any: its state, the options and the active one. */
async function searchState(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('dialog.docs-search-dialog');
    const input = dialog?.querySelector('input[role="combobox"]');
    const active = input?.getAttribute('aria-activedescendant');
    return {
      open: dialog?.open ?? false,
      focused: document.activeElement === input,
      value: input?.value ?? null,
      expanded: input?.getAttribute('aria-expanded') ?? null,
      options: dialog ? dialog.querySelectorAll('[role="option"]').length : 0,
      pages: dialog ? [...dialog.querySelectorAll('.docs-search-page')].map((element) => element.textContent?.trim() ?? '') : [],
      active: active ? (document.getElementById(active)?.textContent?.trim() ?? null) : null,
      status: dialog?.querySelector('.docs-search-status')?.textContent?.trim() ?? null,
      count: dialog?.querySelector('[role="status"]')?.textContent?.trim() ?? null,
      highlights: typeof CSS !== 'undefined' && CSS.highlights ? (CSS.highlights.get('fd-search')?.size ?? 0) : 0,
    };
  });
}

/** Search: button and shortcuts, a word from Accessibility → Enter opens the page; states, Escape, axe. */
async function search(page, base, phone, still, failures) {
  const result = {};
  const fail = (step, state) => failures.push(`search ${step}: ${JSON.stringify(state)}`);
  await page.goto(`${base}/docs/components/toaster`);
  await wait(page, 600);
  const button = phone ? page.locator('.docs-mobile-bar .docs-search-compact') : page.locator('.docs-sidebar .docs-search');

  // The button opens an empty window with the hint, the field focused.
  await button.click();
  await wait(page, 500);
  result.empty = await searchState(page);
  if (!result.empty.open || !result.empty.focused || !result.empty.status) fail('empty', result.empty);
  await still('search-empty');
  result.axeEmpty = await axe(page);

  // `/` inside the field is a character, not the shortcut.
  await page.keyboard.type('a/b');
  await wait(page, 200);
  result.slashInField = (await searchState(page)).value;
  if (result.slashInField !== 'a/b') fail('slash in field', result.slashInField);
  await page.locator('dialog.docs-search-dialog input').fill('');

  // A word nobody wrote: the no-result state.
  await page.keyboard.type('zzqxv');
  await wait(page, 1200);
  result.none = await searchState(page);
  if (result.none.options !== 0 || !/No results/u.test(result.none.status ?? '')) fail('no results', result.none);
  await still('search-none');
  await page.locator('dialog.docs-search-dialog input').fill('');

  // A word from Accessibility: its page comes first, highlighted, and the arrows move.
  await page.keyboard.type(SEARCH_QUERY);
  await wait(page, 1200);
  result.found = await searchState(page);
  if (result.found.pages[0] !== SEARCH_PAGE.name || result.found.expanded !== 'true' || !result.found.active?.startsWith(SEARCH_PAGE.name)) fail('results', result.found);
  if (result.found.highlights === 0) fail('highlight', result.found);
  await still('search-results');
  result.axeResults = await axe(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const down = (await searchState(page)).active;
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  const back = (await searchState(page)).active;
  result.arrows = { down, back };
  if (down === back || back !== result.found.active) fail('arrows', result.arrows);

  // Enter opens the page; the window closes.
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => url.pathname === SEARCH_PAGE.path, { timeout: 5000 }).catch(() => {});
  await wait(page, 600);
  result.navigated = { path: new URL(page.url()).pathname, open: (await searchState(page)).open, h1: await page.locator('article h1').textContent() };
  if (result.navigated.path !== SEARCH_PAGE.path || result.navigated.open || result.navigated.h1 !== SEARCH_PAGE.name) fail('enter', result.navigated);
  await still('search-enter');

  // Escape closes and the focus goes back to the button; on phones the close button closes too.
  await button.focus();
  await page.keyboard.press('Enter');
  await wait(page, 400);
  await page.keyboard.press('Escape');
  await wait(page, 300);
  result.escape = { open: (await searchState(page)).open, focusBack: await button.evaluate((element) => document.activeElement === element) };
  if (result.escape.open || !result.escape.focusBack) fail('escape', result.escape);
  if (phone) {
    await button.click();
    await wait(page, 400);
    await page.getByRole('button', { name: 'Close search' }).click();
    await wait(page, 300);
    result.closeButton = !(await searchState(page)).open;
    if (!result.closeButton) fail('close button', result.closeButton);
  }

  // Shortcuts: ⌘K and Ctrl K toggle, `/` opens when the focus is not in a field.
  result.shortcuts = {};
  for (const key of ['Meta+k', 'Control+k', '/']) {
    await page.locator('article h1').click();
    await page.keyboard.press(key);
    await wait(page, 400);
    const opened = (await searchState(page)).open;
    await page.keyboard.press(key === '/' ? 'Escape' : key);
    await wait(page, 300);
    const closed = !(await searchState(page)).open;
    result.shortcuts[key] = { opened, closed };
    if (!opened || !closed) fail(`shortcut ${key}`, result.shortcuts[key]);
  }

  // No search outside the documentation (the landing; /color-picker's paint would fill the console with WebGL notes).
  result.elsewhere = {};
  for (const path of ['/toaster']) {
    await page.goto(`${base}${path}`);
    await wait(page, 800);
    await page.keyboard.press('Meta+k');
    await page.keyboard.press('/');
    await wait(page, 400);
    result.elsewhere[path] = await page.evaluate(() => document.querySelectorAll('dialog.docs-search-dialog, .docs-search').length);
    if (result.elsewhere[path] !== 0) fail(`on ${path}`, result.elsewhere[path]);
  }
  return result;
}

/** The output for agents is served next to the pages, as text and Markdown. */
async function agents(page, base, failures) {
  const files = { '/llms.txt': '# Cloudlet', '/llms-full.txt': '# Introduction', '/docs/components/toaster.md': '# Toaster', '/docs/components/toaster/accessibility.md': '# Accessibility', '/docs/components/toaster/api/toaster.md': '# Toaster props', '/r/toaster.json': '{' };
  const result = {};
  for (const [path, start] of Object.entries(files)) {
    result[path] = await page.evaluate(async (url) => {
      const response = await fetch(url);
      return { status: response.status, type: response.headers.get('content-type'), start: (await response.text()).split('\n')[0] };
    }, `${base}${path}`);
    if (result[path].status !== 200 || result[path].start !== start) failures.push(`agents ${path}: ${JSON.stringify(result[path])}`);
  }
  return result;
}

async function axe(page) {
  const audit = await new AxeBuilder({ page }).analyze();
  return audit.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
}

/** Sidebar links of the documentation (the drawer on phones holds the same list). */
async function sidebarLinks(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('nav[aria-label="Documentation"] a')]
      .filter((link, index, all) => all.findIndex((other) => other.getAttribute('href') === link.getAttribute('href')) === index)
      .map((link) => ({ name: link.textContent?.trim() ?? '', href: link.getAttribute('href') ?? '' })),
  );
}

async function run(name, scenario, base, out) {
  const browser = await chromium.launch();
  const videoDir = join(out, `${name}-video`);
  const context = await browser.newContext({ ...scenario.context, recordVideo: { dir: videoDir, size: scenario.context.viewport } });
  const page = await context.newPage();
  const failures = [];
  const console_ = [];
  // Links to documentation pages that are not written yet are prefetched and 404 until the page lands:
  // reported, not failed, as long as the page is not in the sidebar.
  const pending = new Set();
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (response.status() === 404 && path.startsWith('/docs/components/toaster/')) pending.add(path);
    else if (response.status() >= 400) console_.push(`${response.status()} ${path}`);
  });
  page.on('console', (message) => {
    if (!['error', 'warning'].includes(message.type())) return;
    const at = message.location()?.url ? new URL(message.location().url).pathname : '';
    if (message.text().startsWith('Failed to load resource') && pending.has(at)) return;
    console_.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => console_.push(`pageerror: ${error.message}`));
  const phone = scenario.context.isMobile === true;
  const still = async (step) => page.screenshot({ path: still.path(step), fullPage: false });
  still.path = (step) => join(out, `${name}-${step}.png`);

  await page.goto(`${base}/docs/components/toaster`);
  await wait(page, 800);
  const report = { name, pages: [], axe: {}, quiet: null, toc: null, copy: null, drawer: null, installation: null, preview: null, guides: null, picker: null, integration: null, reference: null, search: null, agents: null };

  // Quiet mode: no sky, no Lenis, a flat page colour.
  report.quiet = await page.evaluate(() => ({
    sky: document.querySelector('.sky') !== null,
    lenis: document.documentElement.classList.contains('lenis'),
    dark: document.documentElement.classList.contains('dark'),
  }));
  if (report.quiet.sky || report.quiet.lenis) failures.push(`quiet mode: ${JSON.stringify(report.quiet)}`);
  await still('introduction');
  report.axe.introduction = await axe(page);

  // Every sidebar page opens, with the right title and a clean console.
  const links = await sidebarLinks(page);
  for (const link of links.filter((item) => item.href.startsWith('/docs/components/toaster'))) {
    await page.goto(`${base}${link.href}`);
    await wait(page, 500);
    const h1 = await page.locator('article h1').textContent();
    const ok = h1?.trim() === link.name;
    if (!ok) failures.push(`${link.href}: h1 "${h1}" for sidebar "${link.name}"`);
    report.pages.push({ ...link, h1: h1?.trim(), ok });
  }
  await page.goto(`${base}/docs/components/toaster`);
  await wait(page, 500);

  // Table of contents: the first entry points at a heading on the page; on phones it is a disclosure.
  if (phone) {
    const summary = page.locator('.docs-toc-mobile summary');
    await summary.click();
    await wait(page, 300);
  }
  const toc = page.locator(phone ? '.docs-toc-mobile .docs-toc-item' : '.docs-toc .docs-toc-item');
  const first = await toc.first().getAttribute('href');
  report.toc = { count: await toc.count(), first, target: first ? await page.locator(first).count() : 0 };
  if (report.toc.count === 0 || report.toc.target !== 1) failures.push(`toc: ${JSON.stringify(report.toc)}`);
  // The component page's sections and the groups of its Examples are all in the table of contents.
  report.toc.entries = await toc.evaluateAll((items) => items.map((item) => item.getAttribute('href')));
  const missing = TOC_ENTRIES.filter((entry) => !report.toc.entries.includes(entry));
  if (missing.length) failures.push(`toc misses ${missing.join(', ')}`);
  await toc.first().click();
  await wait(page, 600);
  await still('toc');
  if (phone) await page.locator('.docs-toc-mobile summary').click();

  // Copy copies the example verbatim.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const figure = page.locator('.docs-code').first();
  await figure.scrollIntoViewIfNeeded();
  await figure.getByRole('button', { name: /Copy/ }).click();
  await wait(page, 300);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const source = await figure.locator('pre').evaluate((pre) => pre.textContent?.replace(/\n$/u, '') ?? '');
  report.copy = { ok: copied === source && copied.length > 0, length: copied.length };
  if (!report.copy.ok) failures.push(`copy: ${copied.length} chars vs ${source.length}`);
  await still('code');

  report.installation = await installation(page, base, still, failures);
  report.axe.installation = report.installation.axe;
  report.preview = await preview(page, base, phone, still, failures);
  report.axe.preview = report.preview.axe.page;
  report.axe.previewToast = report.preview.axe.toast;
  report.guides = await guides(page, base, still, failures);
  for (const [slug, entry] of Object.entries(report.guides)) {
    report.axe[slug] = entry.axe.page;
    report.axe[`${slug}Toast`] = entry.axe.toast ?? [];
  }
  report.picker = await pickerPage(page, base, still, failures);
  report.axe.picker = report.picker.axe;
  report.integration = await integration(page, base, still, failures);
  for (const [slug, entry] of Object.entries(report.integration)) report.axe[slug] = entry.axe;
  report.reference = await reference(page, base, phone, still, failures);
  for (const [slug, entry] of Object.entries(report.reference)) report.axe[`api-${slug}`] = entry.axe;
  report.search = await search(page, base, phone, still, failures);
  report.axe.searchEmpty = report.search.axeEmpty;
  report.axe.searchResults = report.search.axeResults;
  report.agents = await agents(page, base, failures);
  await page.goto(`${base}/docs/components/toaster`);
  await wait(page, 500);

  // Phones: the drawer opens from Menu with the keyboard, lists the sidebar, closes on Escape and
  // gives the focus back; axe with it open. Its search button closes it and opens the search.
  if (phone) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    await menu.focus();
    await page.keyboard.press('Enter');
    await wait(page, 400);
    const dialog = page.locator('dialog.docs-drawer');
    report.drawer = {
      open: await dialog.evaluate((element) => element.open),
      links: await dialog.locator('a').count(),
    };
    await still('drawer');
    report.axe.drawer = await axe(page);
    await page.keyboard.press('Escape');
    await wait(page, 300);
    report.drawer.closed = !(await dialog.evaluate((element) => element.open));
    report.drawer.focusBack = await menu.evaluate((element) => document.activeElement === element);
    if (!report.drawer.open || !report.drawer.closed || !report.drawer.focusBack || report.drawer.links === 0) failures.push(`drawer: ${JSON.stringify(report.drawer)}`);
    await menu.click();
    await wait(page, 400);
    await dialog.locator('.docs-search').click();
    await wait(page, 500);
    report.drawer.search = { drawer: await dialog.evaluate((element) => element.open), search: (await searchState(page)).open };
    await still('drawer-search');
    if (report.drawer.search.drawer || !report.drawer.search.search) failures.push(`drawer search: ${JSON.stringify(report.drawer.search)}`);
    await page.keyboard.press('Escape');
    await wait(page, 300);
  }

  for (const [step, violations] of Object.entries(report.axe)) {
    if (violations.length) failures.push(`axe ${step}: ${violations.join('; ')}`);
  }
  if (console_.length) failures.push(`console: ${console_.join(' | ')}`);
  report.console = console_;
  report.pendingLinks = [...pending].sort();
  const sidebar = new Set(links.map((link) => link.href));
  for (const path of pending) if (sidebar.has(path)) failures.push(`${path} is in the sidebar but 404`);
  report.failures = failures;
  const video = page.video();
  await context.close();
  if (video) renameSync(await video.path(), join(out, `${name}.webm`));
  rmSync(videoDir, { recursive: true, force: true });
  await browser.close();
  return report;
}

const [outDir, ...only] = process.argv.slice(2);
if (!outDir) {
  console.error('Usage: node apps/site/scripts/record-docs.mjs <out-dir> [scenario ...]');
  process.exit(2);
}
const out = resolve(outDir);
mkdirSync(out, { recursive: true });
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const reports = [];
try {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    if (only.length && !only.includes(name)) continue;
    const report = await run(name, scenario, base, out);
    reports.push(report);
    console.log(`${name}: ${report.failures.length ? `FAILED\n  ${report.failures.join('\n  ')}` : 'ok'} (${report.pages.length} pages)`);
  }
} finally {
  server.close();
}
writeFileSync(join(out, 'report.json'), JSON.stringify(reports, null, 2) + '\n');
process.exit(reports.some((report) => report.failures.length) ? 1 : 0);
