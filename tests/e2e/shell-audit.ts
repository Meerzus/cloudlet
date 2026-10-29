import { mkdir } from 'node:fs/promises';
import { expect } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';

/**
 * Shared runtime audit of the stack → Island shell on the production laboratory
 * (strict CSP, `style-src-attr 'none'`): CSP violations, page errors, style attributes,
 * at most one inert snapshot per layer, one live slide, pending animation frames,
 * ResizeObserver targets and the text of both live regions.
 */
export interface ShellAudit {
  violations: { directive: string; blocked: string }[];
  errors: string[];
  rafScheduled: number;
  rafPending: number;
  resizeTargets: number;
  /** Most snapshots ever seen at once in one snapshot container, per layer. */
  maxSnapshots: Record<string, number>;
  maxLiveSlides: number;
  styleAttributes: number;
  speech: { urgency: string; text: string; at: number }[];
  unsafeFocus: string[];
  lastPointerId: number | null;
}
declare global { interface Window { __shellAudit: ShellAudit } }

export const snapshotLayers = ['cloudlet-exit', 'cloudlet-slide-out', 'cloudlet-chrome-out', 'cloudlet-heading-out', 'cloudlet-body-out', 'cloudlet-badge-out', 'cloudlet-page-out'];

export async function installShellAudit(page: Page) {
  await page.addInitScript(names => {
    const audit: ShellAudit = { violations: [], errors: [], rafScheduled: 0, rafPending: 0, resizeTargets: 0, maxSnapshots: {}, maxLiveSlides: 0, styleAttributes: 0, speech: [], unsafeFocus: [], lastPointerId: null };
    window.__shellAudit = audit;
    document.addEventListener('securitypolicyviolation', event => audit.violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
    window.addEventListener('error', event => { if (event.message) audit.errors.push(event.message); });
    window.addEventListener('unhandledrejection', event => audit.errors.push(String(event.reason)));
    document.addEventListener('pointerdown', event => { audit.lastPointerId = event.pointerId; }, true);
    const raf = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const pending = new Set<number>();
    window.requestAnimationFrame = callback => {
      audit.rafScheduled += 1;
      const id = raf(time => { pending.delete(id); audit.rafPending = pending.size; callback(time); });
      pending.add(id); audit.rafPending = pending.size;
      return id;
    };
    window.cancelAnimationFrame = id => { pending.delete(id); audit.rafPending = pending.size; cancel(id); };
    const Resize = window.ResizeObserver;
    window.ResizeObserver = class extends Resize {
      private observed = new Set<Element>();
      override observe(target: Element, options?: ResizeObserverOptions) {
        if (!this.observed.has(target)) { this.observed.add(target); audit.resizeTargets += 1; }
        super.observe(target, options);
      }
      override unobserve(target: Element) {
        if (this.observed.delete(target)) audit.resizeTargets -= 1;
        super.unobserve(target);
      }
      override disconnect() { audit.resizeTargets -= this.observed.size; this.observed.clear(); super.disconnect(); }
    };
    const previous = new WeakMap<Element, string>();
    const inspect = () => {
      for (const name of names) {
        for (const container of document.querySelectorAll(`.cloudlet-host .${name}`)) {
          audit.maxSnapshots[name] = Math.max(audit.maxSnapshots[name] ?? 0, container.childElementCount);
        }
      }
      audit.maxLiveSlides = Math.max(audit.maxLiveSlides, document.querySelectorAll('.cloudlet-stack > .cloudlet-shell > .cloudlet-clip > .cloudlet-slide').length);
      audit.styleAttributes = document.querySelectorAll('.cloudlet-host [style], .cloudlet-host[style]').length;
      for (const region of document.querySelectorAll('[data-cloudlet-announcer]')) {
        const text = region.textContent?.trim() ?? '';
        if (previous.get(region) !== text && text) audit.speech.push({ urgency: region.getAttribute('aria-live') ?? '', text, at: performance.now() });
        previous.set(region, text);
      }
      const active = document.activeElement;
      if (active?.closest('.cloudlet-host') && active.closest('[hidden],[inert],[aria-hidden="true"]')) audit.unsafeFocus.push(active.outerHTML.slice(0, 200));
    };
    new MutationObserver(inspect).observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
    // React restores the pre-commit selection before layout effects move focus on; judge focus after the commit.
    document.addEventListener('focusin', () => queueMicrotask(inspect));
  }, snapshotLayers);
}

/** Opens a production route and checks the strict policy header. */
export async function openRoute(page: Page, route: string) {
  await installShellAudit(page);
  const response = await page.goto(route);
  expect(response?.headers()['content-security-policy']).toContain("style-src-attr 'none'");
  expect(response?.headers()['content-security-policy']).not.toContain('unsafe-inline');
}

/** Attaches the audit and asserts the invariants every scenario shares. */
export async function finishAudit(page: Page, info: TestInfo, name: string) {
  const audit = await page.evaluate(() => window.__shellAudit).catch(() => null);
  if (!audit) return;
  await info.attach(name, { body: JSON.stringify({ project: info.project.name, title: info.title, audit }, null, 2), contentType: 'application/json' });
  expect(audit.errors).toEqual([]);
  expect(audit.violations).toEqual([]);
  expect(audit.unsafeFocus).toEqual([]);
  expect(audit.styleAttributes).toBe(0);
  expect(audit.maxLiveSlides).toBeLessThanOrEqual(1);
  for (const layer of snapshotLayers) expect(audit.maxSnapshots[layer] ?? 0, layer).toBeLessThanOrEqual(1);
}

/** Waits until the host sampler has no scheduled frame (an idle host never keeps a RAF loop). */
export async function idle(page: Page) {
  await expect.poll(() => page.evaluate(() => window.__shellAudit.rafPending), { timeout: 10_000 }).toBe(0);
}

export const speech = (page: Page) => page.evaluate(() => window.__shellAudit.speech);

/** The shell's layout box and the SVG background size written by the sampler. */
export async function geometry(shell: Locator) {
  return shell.evaluate(element => {
    const svg = element.querySelector('.cloudlet-bg')!;
    const box = element.getBoundingClientRect();
    return { x: Math.round(box.x * 100) / 100, y: Math.round(box.y * 100) / 100, width: Math.round(box.width * 100) / 100, height: Math.round(box.height * 100) / 100,
      bottom: Math.round((box.y + box.height) * 100) / 100, svgWidth: Number(svg.getAttribute('width')), svgHeight: Number(svg.getAttribute('height')) };
  });
}

/** Playwright's WebKit screenshot helper injects a nonce-less style, which this CSP rightly blocks. */
export async function screenshot(page: Page, info: TestInfo, name: string) {
  if (info.project.name === 'webkit') return;
  await mkdir('artifacts/task18', { recursive: true });
  const path = `artifacts/task18/${info.project.name}-${name}.png`;
  await info.attach(name, { body: await page.screenshot({ path, caret: 'initial' }), contentType: 'image/png' });
}

/** `translateX` of an element's computed transform, read in the browser. */
export const translateX = (target: Locator) => target.evaluate(element => {
  const value = getComputedStyle(element).transform;
  return value === 'none' ? 0 : new DOMMatrix(value).e;
});
export const translateY = (target: Locator) => target.evaluate(element => {
  const value = getComputedStyle(element).transform;
  return value === 'none' ? 0 : new DOMMatrix(value).f;
});

/** Mouse drag from the centre of `target` by (dx, dy) in `steps`, optionally pausing between steps. */
export async function drag(page: Page, target: Locator, dx: number, dy: number, steps = 6, delay = 0, release = true) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(x + dx * step / steps, y + dy * step / steps);
    if (delay) await page.waitForTimeout(delay);
  }
  if (release) await page.mouse.up();
  return { x, y };
}

/** WebKit's native Tab policy skips buttons; match it instead of changing the widget. */
export async function nativeTab(_page: Page, info: TestInfo) {
  if (info.project.name !== 'webkit') return 'Tab';
  return 'Alt+Tab';
}
