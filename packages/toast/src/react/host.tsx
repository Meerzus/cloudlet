import { Component, createRef, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type { HostLease, RendererBridge, RendererSnapshot } from '../contracts/internal.js';
import type { NotificationHandle } from '../contracts/identity.js';
import type { NotificationSnapshot } from '../contracts/snapshots.js';
import type { ToasterOffsets, ToasterProps } from '../react.js';
import { Body, closeButton, defaultLabels, Heading, partClasses, SlidePreview, slotRenderer } from './card.js';
import { createAnnouncer } from './announcer.js';
import { createSwipe, decideRelease, rubberBand } from './gestures.js';
import type { SwipeCandidate, SwipeSession } from './gestures.js';
import { createShellMotion, MOTION, resolveMotion } from './motion.js';
import type { Fling, ShapeMode, ShellFrame, ShellMotion, SwapLayer } from './motion.js';
import { createRoundedRectPath } from './shape.js';
import { emptyView, planShell, shellView } from './plan.js';
import type { ShellPlan, ShellView } from './plan.js';
import { visibleViewport } from './viewport.js';

interface HostProps {
  readonly bridge: RendererBridge<ReactNode>;
  readonly lease: HostLease;
  readonly snapshot: RendererSnapshot<ReactNode>;
  readonly options: ToasterProps;
  readonly document: Document;
}

type Presented = NotificationSnapshot<ReactNode>;

/** Snapshots are frozen inert DOM pictures: no ids, roles, aria, links or nested snapshots. */
function inertClone<T extends Element>(element: T): T {
  const clone = element.cloneNode(true) as T;
  for (const node of [clone, ...clone.querySelectorAll('*')]) {
    for (const { name } of [...node.attributes]) {
      if (name === 'id' || name === 'role' || name === 'tabindex' || name === 'href' || name.startsWith('aria-')
        || name.startsWith('data-cloudlet-')) node.removeAttribute(name);
    }
  }
  for (const nested of clone.querySelectorAll(snapshotContainers)) nested.replaceChildren();
  for (const removed of clone.querySelectorAll('.cloudlet-live,.cloudlet-pill')) removed.remove();
  return clone;
}
const snapshotContainers = '.cloudlet-exit,.cloudlet-slide-out,.cloudlet-chrome-out,.cloudlet-heading-out,.cloudlet-body-out,.cloudlet-badge-out,.cloudlet-page-out';
type Layer = 'exit' | 'slide' | 'chrome' | SwapLayer;

interface Pending {
  readonly plan: ShellPlan;
  readonly clones: Partial<Record<Layer, Element>>;
  /** Visual position of the shared heading before a morph, for FLIP. */
  readonly heading: DOMRect | null;
  /** Layout height before the commit: bottom-edge snapshots keep their distance to the bottom. */
  readonly height: number;
}

/**
 * Owns all DOM focus, motion and environmental resources for one attachment.
 * One persistent shell renders both the collapsed pill and the Island: an SVG
 * rounded-rect path, the same path as HTML clip-path, and measured HTML inside.
 */
export class Host extends Component<HostProps> {
  readonly #runtime = createHostRuntime(this);
  override componentDidMount = this.#runtime.componentDidMount;
  override getSnapshotBeforeUpdate = this.#runtime.getSnapshotBeforeUpdate;
  override componentDidUpdate = this.#runtime.componentDidUpdate;
  override componentWillUnmount = this.#runtime.componentWillUnmount;
  override render = this.#runtime.render;
}

const rulePaths = {
  viewport: '',
  shell: ' .cloudlet-stack > .cloudlet-shell',
  bg: ' .cloudlet-stack > .cloudlet-shell > .cloudlet-bg',
  clip: ' .cloudlet-stack > .cloudlet-shell > .cloudlet-clip',
  badge: ' .cloudlet-stack > .cloudlet-shell > .cloudlet-badge',
  badgeIn: ' .cloudlet-stack > .cloudlet-shell > .cloudlet-badge > .cloudlet-badge-value',
  badgeOut: ' .cloudlet-stack > .cloudlet-shell > .cloudlet-badge > .cloudlet-badge-out',
  slideOut: ' .cloudlet-stack > .cloudlet-shell > .cloudlet-clip > .cloudlet-slide-out',
  peek: ' .cloudlet-stack > .cloudlet-shell > .cloudlet-clip > .cloudlet-peek',
  chrome: ' .cloudlet-stack > .cloudlet-shell > .cloudlet-clip > :is(.cloudlet-close,.cloudlet-indicator)',
  chromeOut: ' .cloudlet-stack > .cloudlet-shell > .cloudlet-clip > .cloudlet-chrome-out',
  headerIn: ' .cloudlet-stack > .cloudlet-shell > .cloudlet-clip > .cloudlet-slide > .cloudlet-header > .cloudlet-heading',
  headerOut: ' .cloudlet-stack > .cloudlet-shell > .cloudlet-clip > .cloudlet-slide > .cloudlet-header > .cloudlet-heading-out',
  body: ' .cloudlet-stack > .cloudlet-shell > .cloudlet-clip > .cloudlet-slide > .cloudlet-body',
  bodyOut: ' .cloudlet-stack > .cloudlet-shell > .cloudlet-clip > .cloudlet-slide > .cloudlet-body-out',
  pageIn: ' .cloudlet-stack > .cloudlet-shell > .cloudlet-clip > .cloudlet-indicator > .cloudlet-page > .cloudlet-page-value',
  pageOut: ' .cloudlet-stack > .cloudlet-shell > .cloudlet-clip > .cloudlet-indicator > .cloudlet-page > .cloudlet-page-out',
  tail1: ' .cloudlet-stack > [data-cloudlet-tail="1"]',
  tail2: ' .cloudlet-stack > [data-cloudlet-tail="2"]',
  exit: ' .cloudlet-stack > .cloudlet-exit',
  exitClip: ' .cloudlet-stack > .cloudlet-exit > .cloudlet-shell > .cloudlet-clip',
  exitBg: ' .cloudlet-stack > .cloudlet-exit > .cloudlet-shell > .cloudlet-bg',
  exitBadge: ' .cloudlet-stack > .cloudlet-exit > .cloudlet-shell > .cloudlet-badge',
} as const;
type Rule = keyof typeof rulePaths;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
/** Native `inert` without relying on React 19's boolean prop (React 18.2 is supported). */
const inertRef = (node: HTMLElement | null) => node?.setAttribute('inert', '');
const px = (value: number) => `${Math.round(value * 100) / 100}px`;
const blur = (amount: number, reduced: boolean) => reduced || amount <= 0.01 ? 'none' : `blur(${px(amount)})`;
function token(style: CSSStyleDeclaration | undefined, name: string, fallback: number) {
  const value = parseFloat(style?.getPropertyValue(name) ?? '');
  return Number.isFinite(value) ? value : fallback;
}

// Keep React's pre-mutation lifecycle for focus and snapshots. Attachment state is
// closure-private, so ordinary lexical minification needs no property mangling.
function createHostRuntime(owner: Host) {
  // Toaster keys Host by lease; these capabilities stay fixed for its lifetime.
  const { bridge, lease, document: doc } = owner.props;
  const view = doc.defaultView;
  const rootRef = createRef<HTMLDivElement>();
  const styleRef = createRef<HTMLStyleElement>();
  const stackRef = createRef<HTMLDivElement>();
  const shellRef = createRef<HTMLDivElement>();
  const clipRef = createRef<HTMLDivElement>();
  const bgRef = createRef<SVGSVGElement>();
  const pathRef = createRef<SVGPathElement>();
  const exitRef = createRef<HTMLDivElement>();
  const slideOutRef = createRef<HTMLDivElement>();
  const chromeOutRef = createRef<HTMLDivElement>();
  const announcer = createAnnouncer(bridge, lease, doc, () => owner.props.options.announcements);
  let previousFocus: HTMLElement | null = null;
  let navigating: NotificationHandle | null = null;
  let focusedBefore: HTMLElement | null = null;
  let restoreAfterCommit = false;
  let cleanup: (() => void) | null = null;
  let rules: Partial<Record<Rule, CSSStyleDeclaration>> = {};
  let mounted = false;
  let activation: Element | null = null;
  let repeating = false;
  let motion: ShellMotion | null = null;
  // `ToasterMotion.overrides` (debugging): resolved only when the object changes.
  let overrides = owner.props.options.motion?.overrides;
  let constants = resolveMotion(overrides);
  const syncConstants = () => {
    const next = owner.props.options.motion?.overrides;
    if (next === overrides) return;
    overrides = next;
    constants = resolveMotion(next);
    motion?.setConstants(constants);
  };
  let reduced = false;
  let hovering = false;
  let observer: ResizeObserver | null = null;
  /** Live layout box of the shell (the target shape); the SVG and clip follow it. */
  let layout = { width: 0, height: 0, bodyTop: 0 };
  /** Top of the body that left in the running slide (the outgoing snapshot sits there). */
  let slideTop = 0;
  /** When the body last changed: a stream of updates crossfades once (`bodyQuiet`), then changes in place. */
  let lastBodyUpdate = -Infinity;
  let tokens = { tailOffset: 4, tailScale: 0.9, pillHeight: 44 };
  let measurable = false;
  let shapeMode: ShapeMode = 'instant';
  /** Motion groups that still hide the presented content; presentation waits for none. */
  const revealing = new Set<string>();
  /** Tails kept mounted while they retract or fade out. */
  let heldTails = 0;
  let badgeCount = 2;
  let progressFill: SVGCircleElement | null = null;
  let progressHandle: NotificationHandle | null = null;
  let progressActive = false;
  let unreadable: NotificationHandle | null = null;
  let swipe: ReturnType<typeof createSwipe> | null = null;
  /** Document direction of the last render: physical swipe/slide sides mirror in RTL. */
  let rtl = false;
  /** Inert neighbour shown only while a finger drags the Island content; side +1 is physically right. */
  let peek: { readonly handle: NotificationHandle; readonly side: 1 | -1 } | null = null;
  /** The record a running swipe (or its intent window) belongs to; a change of target cancels it. */
  let gestureTarget: { readonly handle: NotificationHandle; readonly open: boolean } | null = null;
  /** A committed swipe dismiss: its exit snapshot keeps flying from the release point. */
  let fling: (Fling & { readonly handle: NotificationHandle }) | null = null;
  // Formatter failures found during render are reported after commit, once per function.
  const failedFormatters = new WeakSet<object>();
  const formatterErrors: unknown[] = [];
  function format<Args extends readonly unknown[]>(formatter: (...args: Args) => string, fallback: (...args: Args) => string, ...args: Args): string {
    try {
      const text = formatter(...args);
      if (typeof text !== 'string') throw new TypeError('Label formatter must return a string');
      return text;
    } catch (error) {
      if (!failedFormatters.has(formatter)) { failedFormatters.add(formatter); formatterErrors.push(error); }
      return fallback(...args);
    }
  }
  function reportFormatterErrors() {
    for (const error of formatterErrors.splice(0)) bridge.reportDiagnostic(lease, { code: 'formatter-error',
      source: 'Toaster.labels', message: 'A label formatter failed', error });
  }
  const pause = (reason: 'focus' | 'hover' | 'document-hidden' | 'window-blur', active: boolean) =>
    bridge.setPause(lease, { scope: 'host', reason, active });
  const hover = (active: boolean) => {
    if (hovering === active) return;
    hovering = active;
    pause('hover', active);
    motion?.setHover(active);
  };
  const rejectSlotFocus = (previous: EventTarget | null) => {
    rememberExternal(previous);
    if (view && previous instanceof view.HTMLElement && !previous.closest('.cloudlet-slot') && restoreFocus(previous)) return;
    if (!restoreFocus(previousFocus)) {
      const active = doc.activeElement;
      if (view && active instanceof view.HTMLElement) active.blur();
      rootRef.current?.focus({ preventScroll: true });
    }
  };

  function rememberExternal(element: EventTarget | null) {
    if (view && element instanceof view.HTMLElement && element !== doc.body
      && !rootRef.current?.contains(element)) previousFocus = element;
  }
  function restoreFocus(element: HTMLElement | null): boolean {
    if (!element?.isConnected || element.closest('[hidden],[inert],[aria-hidden="true"]')
      || element.matches(':disabled')) return false;
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = view?.getComputedStyle(ancestor);
      if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse'
        || style?.contentVisibility === 'hidden') return false;
    }
    element.focus({ preventScroll: true });
    return doc.activeElement === element;
  }
  function restoreExternalFocus(): boolean {
    if (restoreFocus(previousFocus)) return true;
    for (const element of doc.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,summary,[tabindex]')) {
      if (element.tabIndex >= 0 && !element.closest('.cloudlet-host') && restoreFocus(element)) return true;
    }
    // The application may have removed every external control. Leave the empty
    // notification region without adding a permanent stop to the document order.
    const original = doc.body.getAttribute('tabindex');
    doc.body.setAttribute('tabindex', '-1');
    const restored = restoreFocus(doc.body);
    if (original === null) doc.body.removeAttribute('tabindex'); else doc.body.setAttribute('tabindex', original);
    return restored;
  }
  const syncFocus = (element: Element | null) => {
    const inside = !!element && !!rootRef.current?.contains(element);
    pause('focus', inside);
    bridge.setFocused(lease, inside ? bridge.getSnapshot().presentation?.handle ?? null : null);
  };
  function measureViewport() {
    if (!mounted || !view) return;
    const width = doc.documentElement.clientWidth || view.innerWidth;
    const height = doc.documentElement.clientHeight || view.innerHeight;
    const rect = visibleViewport(width, height, view.visualViewport);
    for (const edge of ['top', 'right', 'bottom', 'left', 'width', 'height'] as const) {
      rules.viewport?.setProperty(`--cloudlet-viewport-${edge}`, `${rect[edge]}px`);
    }
  }
  const bottomEdge = () => rootRef.current?.dataset.edge === 'bottom';
  const edgeSign = (): -1 | 1 => bottomEdge() ? 1 : -1;

  /** The only DOM writer of animated values: scoped CSSOM rules and SVG attributes. */
  function write(frame: ShellFrame) {
    const r = rules;
    const { reduced: still } = frame;
    const width = Math.max(0, frame.width);
    const height = Math.max(0, frame.height);
    const radius = Math.min(Math.max(0, frame.radius), width / 2, height / 2);
    // At the bottom edge the silhouette grows upwards: it is anchored to the layout bottom.
    const bottom = bottomEdge();
    const top = bottom ? layout.height - height : 0;
    if (r.shell) {
      r.shell.opacity = String(clamp01(frame.opacity));
      r.shell.transform = still ? 'none' : `translate(${px(frame.dragX)}, ${px(frame.y + frame.dragY)}) scale(${frame.scale})`;
    }
    const svg = bgRef.current;
    if (svg) {
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      pathRef.current?.setAttribute('d', createRoundedRectPath(width, height, radius));
    }
    // The shadow token is a box-shadow: the SVG box follows the path's corners.
    if (r.bg) {
      r.bg.borderRadius = px(radius);
      // Layout keeps the box at the top and a transform carries it to the bottom edge: a growing
      // silhouette then moves no layout start point, so the morph is not counted as layout shift (CLS).
      r.bg.top = '0px'; r.bg.bottom = 'auto';
      r.bg.transform = `translateX(-50%) translateY(${px(top)})`;
    }
    if (r.clip) r.clip.clipPath = `path("${createRoundedRectPath(width, height, radius, (layout.width - width) / 2, top)}")`;
    if (r.badge) {
      const scale = still ? 1 : constants.badge.scale + (1 - constants.badge.scale) * frame.badge;
      // Outer corner: top right, mirrored in RTL; the bottom corner at the bottom edge.
      const x = (width / 2 - 10) * (rtl ? -1 : 1);
      r.badge.opacity = String(clamp01(frame.badge));
      r.badge.transform = `translate(calc(${px(x)} - 50%), ${bottom ? '6px' : '-6px'}) scale(${scale})`;
    }
    // Tails peek out one step towards the centre of the screen.
    const inward = bottom ? -1 : 1;
    for (const index of [1, 2] as const) {
      const rule = r[`tail${index}`];
      if (!rule) continue;
      const slot = frame[`tail${index}`];
      rule.width = px(width);
      rule.height = px(Math.min(height, tokens.pillHeight));
      rule.opacity = String(clamp01(frame[`tail${index}Opacity`]));
      rule.transform = `translateX(-50%) translateY(${px(inward * slot * (tokens.tailOffset + constants.hoverLift * frame.lift))}) scale(${Math.pow(tokens.tailScale, slot)})`;
    }
    if (r.slideOut) {
      r.slideOut.transform = still ? 'none' : `translateX(${px(frame.slide - frame.slideDirection * frame.slideWidth)})`;
      r.slideOut.opacity = String(clamp01(frame.slideOut));
    }
    if (r.peek) {
      r.peek.width = px(layout.width);
      r.peek.top = px(layout.bodyTop);
      r.peek.transform = `translateX(${px(frame.slide + (peek?.side ?? 0) * layout.width)})`;
    }
    const shift = still ? 'none' : `translate(${px(frame.headX)}, ${px(frame.headY)})`;
    if (r.headerIn) r.headerIn.transform = shift;
    if (r.headerOut) r.headerOut.transform = shift;
    for (const [rule, value] of [[r.headerIn, frame.headerIn], [r.headerOut, frame.headerOut],
      [r.badgeIn, frame.badgeIn], [r.badgeOut, frame.badgeOut], [r.pageIn, frame.pageIn], [r.pageOut, frame.pageOut]] as const) {
      if (!rule) continue;
      rule.opacity = String(clamp01(value));
      rule.filter = blur((1 - clamp01(value)) * constants.blur, still);
    }
    if (r.chrome) {
      r.chrome.opacity = String(clamp01(frame.chrome));
      r.chrome.transform = still ? 'none' : `translateY(${px((1 - clamp01(frame.chrome)) * constants.chromeOffset)})`;
    }
    if (r.chromeOut) r.chromeOut.opacity = String(clamp01(frame.chromeOut));
    if (r.body) {
      // The body carries the slide between notifications; the header above it blur-swaps instead.
      r.body.opacity = String(clamp01(frame.chrome) * clamp01(frame.bodyIn) * clamp01(frame.slideIn));
      r.body.transform = still ? 'none'
        : `translateX(${px(frame.slide)}) translateY(${px((1 - clamp01(frame.chrome)) * constants.chromeOffset + (1 - clamp01(frame.bodyIn)) * constants.bodyOffset)})`;
    }
    if (r.bodyOut) r.bodyOut.opacity = String(clamp01(frame.bodyOut));
    if (r.exit) {
      r.exit.opacity = String(clamp01(frame.exitOpacity));
      r.exit.transform = still ? 'translateX(-50%)' : `translateX(-50%) translate(${px(frame.exitX)}, ${px(frame.exitY)}) scale(${frame.exitScale})`;
    }
    if (progressActive && progressFill?.isConnected) progressFill.setAttribute('stroke-dasharray', `${Math.round(frame.progress * 10000) / 100} 100`);
  }

  /** Layout size of the stack equals the shell's target box and is unaffected by its transforms. */
  function measure() {
    const stack = stackRef.current;
    const clip = clipRef.current;
    const presented = shellView(owner.props.snapshot).presented;
    if (!stack || !clip || !view || !motion || !presented) { measurable = false; return; }
    const bounds = stack.getBoundingClientRect();
    measurable = bounds.width > 0 && bounds.height > 0;
    syncReadable(presented);
    if (!measurable) return;
    const host = view.getComputedStyle(rootRef.current!);
    tokens = { tailOffset: token(host, '--cloudlet-tail-offset', 4), tailScale: token(host, '--cloudlet-tail-scale', 0.9),
      pillHeight: token(host, '--cloudlet-pill-height', 44) };
    const open = owner.props.snapshot.island.open;
    const corner = parseFloat(view.getComputedStyle(clip).borderTopLeftRadius);
    const radius = Math.min(Number.isFinite(corner) ? corner : open ? 24 : bounds.height / 2, bounds.height / 2, bounds.width / 2);
    layout = { width: bounds.width, height: bounds.height, bodyTop: bodyElement()?.offsetTop ?? 0 };
    motion.setShape({ width: bounds.width, height: bounds.height, radius }, shapeMode);
    shapeMode = 'close';
    syncScrollStop();
  }
  /**
   * A body that scrolls is a named tab stop (WCAG 2.1.1): Safari never makes scrollers focusable,
   * and a focused action below a long description cannot scroll back up to it.
   */
  function syncScrollStop() {
    const body = bodyElement();
    if (!body) return;
    const title = heading()?.querySelector('[data-cloudlet-title]')?.id;
    if (body.scrollHeight - body.clientHeight > 1 && title) {
      body.tabIndex = 0;
      body.setAttribute('role', 'group');
      body.setAttribute('aria-labelledby', title);
    } else for (const name of ['tabindex', 'role', 'aria-labelledby']) body.removeAttribute(name);
  }
  /** A readable record that loses its geometry (hidden host, zero viewport) stops spending time. */
  function syncReadable(presented: Presented | null) {
    const next = presented && !measurable && bridge.getSnapshot().presentation?.readable ? presented.handle : null;
    if (next === unreadable) return;
    if (unreadable) bridge.setPause(lease, { scope: 'notification', handle: unreadable, reason: 'content-transition', active: false });
    unreadable = next;
    if (next) bridge.setPause(lease, { scope: 'notification', handle: next, reason: 'content-transition', active: true });
  }
  /** The presented record is readable once its live slide is visible and no transition still hides it. */
  function acknowledgePresentation() {
    const presentation = bridge.getSnapshot().presentation;
    if (!presentation?.token || presentation.readable || revealing.size) return;
    const node = shellRef.current?.querySelector(`[data-cloudlet-presented="${presentation.handle.generation}"]`);
    const bounds = node?.getBoundingClientRect();
    if (!node || !measurable || !bounds?.width || !bounds.height || view?.getComputedStyle(node).visibility === 'hidden') return;
    bridge.acknowledgePresentation(lease, presentation.handle, presentation.token);
  }
  const reveal = (group: string) => {
    revealing.add(group);
    return () => { revealing.delete(group); acknowledgePresentation(); };
  };
  const relayout = () => { measureViewport(); measure(); acknowledgePresentation(); };
  function primaryFocus(): HTMLElement | null {
    const root = rootRef.current;
    return (owner.props.snapshot.island.open ? root?.querySelector<HTMLElement>('.cloudlet-slide [data-cloudlet-title]') : null)
      ?? root?.querySelector<HTMLElement>('[data-cloudlet-pill]') ?? null;
  }
  function commitFocusRequest() {
    const request = owner.props.snapshot.focusRequest;
    if (!request || bridge.getSnapshot().focusRequest?.token !== request.token) return;
    const root = rootRef.current;
    const target = request.target;
    let element: HTMLElement | null = null;
    if (target.kind === 'anchor') element = root;
    // The acknowledgement lives in the Island; collapsed, the pill names the missed count.
    else if (target.kind === 'overflow') element = root?.querySelector('[data-cloudlet-overflow]') ?? root?.querySelector('[data-cloudlet-pill]') ?? null;
    else if (target.kind === 'notification') {
      const presented = shellRef.current?.querySelector<HTMLElement>(`[data-cloudlet-presented="${target.handle.generation}"]`);
      element = !presented ? null : target.control
        ? shellRef.current!.querySelector(`[data-cloudlet-control="${target.control}"]`) : primaryFocus();
    }
    rememberExternal(doc.activeElement);
    const focused = restoreFocus(element);
    bridge.acknowledgeFocus(lease, request.token, focused ? 'focused' : 'unavailable');
  }
  function clear(layer: Element | null | undefined) { layer?.replaceChildren(); }
  function heading() { return shellRef.current?.querySelector<HTMLElement>(':scope > .cloudlet-clip > .cloudlet-slide > .cloudlet-header > .cloudlet-heading') ?? null; }
  function bodyElement() { return shellRef.current?.querySelector<HTMLElement>(':scope > .cloudlet-clip > .cloudlet-slide > .cloudlet-body') ?? null; }
  /** Pre-mutation pictures of every layer the commit is about to change (one per layer). */
  function takeSnapshots(plan: ShellPlan): Partial<Record<Layer, Element>> {
    const shell = shellRef.current;
    const clip = clipRef.current;
    if (!shell || !clip || !measurable) return {};
    const clones: Partial<Record<Layer, Element>> = {};
    if (plan.presence === 'exit' || plan.presence === 'rise' || plan.presence === 'replace') {
      clones.exit = inertClone(shell);
      // The snapshot keeps the silhouette it had at this instant.
      if (rules.exitClip) rules.exitClip.clipPath = rules.clip?.clipPath ?? '';
      if (rules.exitBg) rules.exitBg.borderRadius = rules.bg?.borderRadius ?? '';
      if (rules.exitBadge) { rules.exitBadge.opacity = rules.badge?.opacity ?? ''; rules.exitBadge.transform = rules.badge?.transform ?? ''; }
      if (rules.exit) rules.exit.width = px(layout.width);
    }
    const leaving = bodyElement();
    if (plan.slide && leaving) {
      // Only the body slides out; the heading blur-swaps in place (plan.header).
      clones.slide = inertClone(leaving);
      slideTop = leaving.offsetTop;
      if (rules.slideOut) rules.slideOut.width = px(layout.width);
    }
    if (plan.morph === 'close') {
      const chrome = inertClone(clip);
      // The live header stays on top; only body, close and indicator fade out.
      chrome.querySelector('.cloudlet-header')?.classList.add('cloudlet-ghost');
      clones.chrome = chrome;
      if (rules.chromeOut) rules.chromeOut.width = px(layout.width);
    }
    const head = heading();
    if (plan.header && head) clones.header = inertClone(head);
    const body = bodyElement();
    // Rapid updates (progress text every 150 ms) must not restart the crossfade: within
    // `bodyQuiet` of the previous update the new text lands in place.
    const now = motion?.now() ?? 0;
    const rapid = plan.body && now - lastBodyUpdate < (motion?.constants.bodyQuiet ?? 0);
    if (plan.body) lastBodyUpdate = now;
    if (plan.body && !plan.slide && body && !rapid && !motion?.swapping('body')) {
      clones.body = inertClone(body);
      if (rules.bodyOut) rules.bodyOut.top = px(body.offsetTop);
    }
    const badge = shell.querySelector(':scope > .cloudlet-badge > .cloudlet-badge-value');
    if (plan.badge && badge) clones.badge = inertClone(badge);
    const page = clip.querySelector(':scope > .cloudlet-indicator > .cloudlet-page > .cloudlet-page-value');
    if (plan.page && page) clones.page = inertClone(page);
    return clones;
  }
  function place(layer: Layer, clone: Element) {
    const shell = shellRef.current;
    const container = layer === 'exit' ? exitRef.current : layer === 'slide' ? slideOutRef.current
      : layer === 'chrome' ? chromeOutRef.current
        : layer === 'header' ? shell?.querySelector(':scope > .cloudlet-clip > .cloudlet-slide > .cloudlet-header > .cloudlet-heading-out')
          : layer === 'body' ? shell?.querySelector(':scope > .cloudlet-clip > .cloudlet-slide > .cloudlet-body-out')
            : layer === 'badge' ? shell?.querySelector(':scope > .cloudlet-badge > .cloudlet-badge-out')
              : shell?.querySelector(':scope > .cloudlet-clip > .cloudlet-indicator > .cloudlet-page > .cloudlet-page-out');
    if (!container) return null;
    // Set the native attribute without relying on React 19's inert prop support.
    container.setAttribute('inert', '');
    container.replaceChildren(clone);
    return container;
  }
  function animate(previous: ShellView, next: ShellView, pending: Pending | null) {
    if (!motion) return;
    const plan = pending?.plan ?? planShell(previous, next);
    // Before any write of this commit: the writer must know which bar it owns.
    syncProgress(next);
    const containers: Partial<Record<Layer, Element | null>> = {};
    for (const [layer, clone] of Object.entries(pending?.clones ?? {}) as [Layer, Element][]) containers[layer] = place(layer, clone);
    const done = (layer: Layer) => () => clear(containers[layer]);
    const tailsDone = () => { if (heldTails) { heldTails = 0; owner.forceUpdate(); } };
    const exitDone = () => clear(exitRef.current);
    if (plan.presence === 'enter') shapeMode = 'instant';
    else if (plan.morph === 'open') shapeMode = 'open';
    measure();
    const from = pending?.heading;
    const to = from && plan.morph !== 'none' ? heading()?.getBoundingClientRect() : null;
    if (from && to) motion.shiftHeading(from.left - to.left, from.top - to.top, plan.morph === 'open' ? 'open' : 'close');
    const edge = edgeSign();
    const flung = fling && previous.presented?.handle === fling.handle && !next.stack.includes(fling.handle) ? fling : undefined;
    if (fling && !next.stack.includes(fling.handle)) fling = null;
    if (plan.presence === 'exit' || plan.presence === 'rise' || plan.presence === 'replace') {
      if (containers.exit) motion.exit(edge, exitDone, flung);
      else if (flung) motion.release('dragX', 0);
      if (plan.presence === 'exit') motion.hide();
    }
    // An arrival keeps the shell: the title blur-swaps and the width springs to the new text.
    if (plan.presence === 'enter' || plan.presence === 'replace') {
      motion.enter(edge, reveal('presence'));
      if (plan.presence === 'enter') {
        motion.setTails(next.depth, 'settle', 0, tailsDone);
        if (next.open) motion.open(); else motion.setBadge(next.badge);
      }
    }
    if (plan.presence === 'rise') {
      motion.rise(-edge * tokens.tailOffset, tokens.tailScale, reveal('presence'));
      motion.swap('header', reveal('header'), true);
    }
    if (plan.tails === 'arrival' || plan.tails === 'rise' || plan.tails === 'settle') {
      if (next.depth < previous.depth) heldTails = Math.max(heldTails, previous.depth);
      motion.setTails(next.depth, plan.tails, previous.depth, tailsDone);
    }
    if (plan.morph === 'open') {
      heldTails = Math.max(heldTails, previous.depth);
      motion.open(tailsDone);
    } else if (plan.morph === 'close') motion.collapse(next.depth, next.badge, { chrome: done('chrome'), tails: tailsDone });
    // Bottom edge: a snapshot keeps its distance to the anchored bottom while the layout height changes.
    const offset = bottomEdge() && pending ? layout.height - pending.height : 0;
    if (rules.slideOut) rules.slideOut.top = px(offset + slideTop);
    if (rules.chromeOut && containers.chrome) rules.chromeOut.top = px(offset);
    if (plan.slide) {
      const finished = reveal('slide');
      // The plan is logical (+1 towards older records); older records lie to the left in RTL.
      motion.slide(rtl ? -plan.slide as 1 | -1 : plan.slide, layout.width, () => { clear(containers.slide); finished(); });
    }
    if (containers.header) {
      const finished = reveal('header');
      motion.swap('header', () => { clear(containers.header); finished(); });
    }
    if (containers.body) motion.swap('body', done('body'));
    if (containers.badge) motion.swap('badge', done('badge'));
    if (containers.page) motion.swap('page', done('page'));
    if (!next.open && previous.presented && next.presented && plan.morph === 'none') motion.setBadge(next.badge);
    // Terminal updates of the same record re-pend its presentation before the swap hides it.
    const presentation = bridge.getSnapshot().presentation;
    if (plan.begin && plan.header && next.presented && presentation?.token && presentation.readable
      && presentation.handle === next.presented.handle) bridge.beginPresentation(lease, next.presented.handle, presentation.token);
  }
  function syncProgress(next: ShellView) {
    const presented = next.presented;
    // The ring lives around the shared status icon: in the pill and in the Island.
    const progress = presented?.content.progress;
    const fill = heading()?.querySelector<SVGCircleElement>(':scope > .cloudlet-icon > .cloudlet-ring > .cloudlet-progress-fill') ?? null;
    const determinate = progress?.kind === 'determinate';
    // A new ring, record or determinate phase starts at its value; later values tween.
    const appeared = fill !== progressFill || presented?.handle !== progressHandle || !progressActive;
    progressFill = fill;
    progressHandle = presented?.handle ?? null;
    progressActive = determinate && !!fill;
    motion?.setProgress(determinate ? progress.value : null, appeared);
  }
  function setPeek(next: typeof peek) {
    if (peek?.handle === next?.handle && peek?.side === next?.side) return;
    peek = next;
    owner.forceUpdate();
  }
  /** Stack: the pill follows the finger; a release past the threshold dismisses it (`reason: 'swipe'`). */
  function dismissSession(handle: NotificationHandle): SwipeSession {
    return {
      move: offset => motion?.drag('dragX', offset),
      end: (offset, velocity) => {
        const decision = decideRelease(offset, velocity, layout.width, { negative: true, positive: true });
        if (decision) {
          fling = { handle, direction: decision, distance: layout.width, velocity: velocity * 1000 };
          if (bridge.dismiss(lease, handle, 'swipe').status === 'applied') return;
          fling = null;
        }
        motion?.release('dragX', velocity * 1000);
      },
      cancel: () => motion?.release('dragX', 0),
    };
  }
  /** Physical neighbour of a record: side +1 is to the right, where older records lie in LTR. */
  function neighbour(handle: NotificationHandle, side: 1 | -1): NotificationHandle | null {
    const stack = owner.props.snapshot.stack;
    const index = stack.indexOf(handle);
    return index < 0 ? null : stack[index + side * (rtl ? -1 : 1)] ?? null;
  }
  /**
   * Island: the content follows the finger inside the fixed shell with the inert
   * neighbour beside it; without a neighbour the edge resists. A release towards a
   * neighbour navigates and the slide continues from the release point and velocity.
   */
  function navigateSession(handle: NotificationHandle): SwipeSession {
    const follow = (offset: number) => {
      const side = offset < 0 ? 1 : -1;
      const target = offset ? neighbour(handle, side) : null;
      setPeek(target ? { handle: target, side } : null);
      return target ? Math.max(-layout.width, Math.min(layout.width, offset)) : rubberBand(offset, layout.width);
    };
    const settle = (velocity: number) => motion?.release('slide', velocity, () => setPeek(null));
    return {
      move: offset => motion?.drag('slide', follow(offset)),
      end: (offset, velocity) => {
        const decision = decideRelease(offset, velocity, layout.width,
          { negative: !!neighbour(handle, 1), positive: !!neighbour(handle, -1) });
        const target = decision ? neighbour(handle, decision < 0 ? 1 : -1) : null;
        if (target) {
          const shown = peek;
          // The commit replaces the preview by the live slide at the same place.
          peek = null;
          motion?.fling('slide', velocity * 1000);
          if (bridge.navigate(lease, target).status === 'applied') return;
          peek = shown;
        }
        settle(peek ? velocity * 1000 : 0);
      },
      cancel: () => settle(0),
    };
  }
  /** Island header: a vertical swipe towards the screen edge collapses to the stack (not a dismiss). */
  function collapseSession(): SwipeSession {
    const toward = bottomEdge() ? 1 : -1;
    // Towards the edge the Island stretches softly; away from it the resistance is strong.
    const resist = (offset: number) => rubberBand(offset, offset * toward > 0 ? layout.height : MOTION.swipe.minDistance);
    return {
      move: offset => motion?.drag('dragY', resist(offset)),
      end: (offset, velocity) => {
        motion?.release('dragY', 0);
        // The edge is a short reach away (gutter + safe area): `edge` px also commits.
        const reach = Math.min(layout.height, MOTION.swipe.edge / MOTION.swipe.distance);
        if (decideRelease(offset, velocity, reach, { negative: toward < 0, positive: toward > 0 })) bridge.collapseIsland(lease);
      },
      cancel: () => motion?.release('dragY', 0),
    };
  }
  /** Which swipes a pointerdown or a wheel stream may start; reduced motion turns swipes off. */
  function beginSwipe(target: Element, input: 'pointer' | 'wheel'): SwipeCandidate | null {
    const shell = shellRef.current;
    const clip = clipRef.current;
    const { presented, open } = shellView(owner.props.snapshot);
    if (reduced || !motion || !measurable || !shell || !clip || !presented || !shell.contains(target)) return null;
    let x: boolean;
    let y = false;
    if (!open) x = input === 'pointer' && !!target.closest('[data-cloudlet-pill]');
    else {
      x = clip.contains(target);
      y = x && input === 'pointer' && !!target.closest('.cloudlet-clip > .cloudlet-slide > .cloudlet-header');
    }
    if (!x && !y) return null;
    const { handle } = presented;
    // Hold the record from the first contact: TTL, attention and the target cannot change under the finger.
    if (bridge.setPause(lease, { scope: 'notification', handle, reason: 'gesture', active: true }).status === 'rejected') return null;
    gestureTarget = { handle, open };
    let released = false;
    return {
      x, y,
      start: axis => !open ? dismissSession(handle) : axis === 'x' ? navigateSession(handle) : collapseSession(),
      release() {
        if (released) return;
        released = true;
        gestureTarget = null;
        bridge.setPause(lease, { scope: 'notification', handle, reason: 'gesture', active: false });
      },
    };
  }
  function componentDidMount() {
    const root = rootRef.current;
    const shell = shellRef.current;
    if (!root || !view || !shell) return;
    mounted = true;
    const sheet = styleRef.current?.sheet;
    const instance = `[data-cloudlet-instance="${owner.props.snapshot.controller}"]`;
    if (sheet) {
      for (const [name, path] of Object.entries(rulePaths) as [Rule, string][]) {
        const index = sheet.insertRule(`${instance}${path} {}`, sheet.cssRules.length);
        rules[name] = (sheet.cssRules[index] as CSSStyleRule).style;
      }
    }
    for (const container of [exitRef.current, slideOutRef.current, chromeOutRef.current]) container?.setAttribute('inert', '');
    announcer.mount(root);
    swipe = createSwipe(root, { begin: beginSwipe, now: () => view.performance.now() });
    const media = view.matchMedia?.('(prefers-reduced-motion: reduce)');
    reduced = media?.matches ?? false;
    root.dataset.reducedMotion = String(reduced);
    motion = createShellMotion({
      now: () => view.performance.now(), requestFrame: callback => view.requestAnimationFrame(callback),
      cancelFrame: id => view.cancelAnimationFrame(id), write, reducedMotion: reduced,
      timeScale: owner.props.options.motion?.timeScale, constants,
    });
    const preference = () => {
      reduced = media?.matches ?? false;
      root.dataset.reducedMotion = String(reduced);
      if (reduced) swipe?.cancel();
      motion?.setReducedMotion(reduced);
    };
    // `auto` follows the same breakpoint as the stylesheet: re-render when it flips.
    const wide = view.matchMedia?.('(min-width: 48rem)');
    // `data-resolved-theme` follows the system scheme while the theme is `system`.
    const scheme = view.matchMedia?.('(prefers-color-scheme: dark)');
    const followScheme = () => { if ((owner.props.options.theme ?? 'system') === 'system') owner.forceUpdate(); };
    const placement = () => { if ((owner.props.options.position ?? 'auto') === 'auto') { swipe?.cancel(); owner.forceUpdate(); } };
    const visibility = () => pause('document-hidden', doc.visibilityState === 'hidden');
    // A pointer press outside the open Island collapses it to the stack.
    const outside = (event: Event) => {
      if (bridge.getSnapshot().island.open && event.target instanceof view.Node && !root.contains(event.target)) bridge.collapseIsland(lease);
    };
    // No mouseout reaches the host when the hovered card is removed or hidden under a still pointer
    // (React then never sees the leave): the next pointer over anything outside releases the pause.
    const hoverOutside = (event: Event) => {
      if (hovering && !(event.target instanceof view.Node && root.contains(event.target))) hover(false);
    };
    const listeners: [EventTarget, string, EventListener, boolean?][] = [
      [doc, 'visibilitychange', visibility],
      [doc, 'pointerdown', outside, true],
      [doc, 'pointerover', hoverOutside, true],
      [view, 'focus', () => pause('window-blur', false)],
      [view, 'blur', () => pause('window-blur', true)],
      [view, 'resize', relayout],
    ];
    if (media) listeners.push([media, 'change', preference]);
    if (wide) listeners.push([wide, 'change', placement]);
    if (scheme) listeners.push([scheme, 'change', followScheme]);
    if (view.visualViewport) listeners.push([view.visualViewport, 'resize', relayout], [view.visualViewport, 'scroll', measureViewport]);
    for (const [target, type, listener, capture] of listeners) target.addEventListener(type, listener, capture);
    cleanup = () => { for (const [target, type, listener, capture] of listeners) target.removeEventListener(type, listener, capture); };
    // Measure HTML only: the clip's layout box never depends on animated values.
    observer = view.ResizeObserver ? new view.ResizeObserver(() => { measure(); acknowledgePresentation(); }) : null;
    if (clipRef.current) observer?.observe(clipRef.current);
    observer?.observe(root);
    visibility();
    pause('window-blur', !doc.hasFocus());
    syncFocus(doc.activeElement);
    measureViewport();
    reportFormatterErrors();
    animate(emptyView, shellView(owner.props.snapshot), null);
    acknowledgePresentation();
    commitFocusRequest();
  }
  function getSnapshotBeforeUpdate(previous: HostProps): Pending | null {
    const before = shellView(previous.snapshot);
    const after = shellView(owner.props.snapshot);
    const plan = planShell(before, after);
    const pending = { plan, clones: takeSnapshots(plan), heading: plan.morph !== 'none' && measurable ? heading()?.getBoundingClientRect() ?? null : null,
      height: layout.height };
    const navigation = navigating;
    navigating = null;
    focusedBefore = null;
    // Navigation keeps browser focus semantics: never redirect focus after a followed link.
    if (navigation && previous.snapshot.notifications.some(item => item.handle === navigation)
      && !owner.props.snapshot.notifications.some(item => item.handle === navigation)) return pending;
    const root = rootRef.current;
    const active = doc.activeElement;
    if (!root || !view || !(active instanceof view.HTMLElement) || active === root || !root.contains(active)
      || structure(previous.snapshot) === structure(owner.props.snapshot)) return pending;
    // The commit may remove or hide the focused branch: park focus on the stable anchor
    // (or outside after the last record) before React mutates the DOM.
    focusedBefore = active;
    const next = owner.props.snapshot;
    restoreAfterCommit = !next.notifications.length && !next.overflow.pending;
    if (!restoreAfterCommit || !restoreExternalFocus()) root.focus({ preventScroll: true });
    return pending;
  }
  function componentDidUpdate(previous: HostProps, _state: unknown, pending: Pending | null) {
    const before = focusedBefore;
    focusedBefore = null;
    if (restoreAfterCommit) {
      restoreAfterCommit = false;
      // React may restore pre-commit focus; leave the empty region again.
      restoreExternalFocus();
    } else if (before && !restoreFocus(before)) {
      // A removed or hidden control hands focus to the Island title, then the pill, then overflow.
      const target = primaryFocus() ?? rootRef.current?.querySelector<HTMLElement>('[data-cloudlet-overflow]') ?? null;
      if (!restoreFocus(target)) rootRef.current?.focus({ preventScroll: true });
    }
    motion?.setTimeScale(owner.props.options.motion?.timeScale);
    syncConstants();
    // A swipe never continues on another record or state (arrival, programmatic dismiss, Escape).
    const next = shellView(owner.props.snapshot);
    if (gestureTarget && (gestureTarget.handle !== next.presented?.handle || gestureTarget.open !== next.open)) swipe?.cancel();
    if (peek && (!next.open || !next.stack.includes(peek.handle))) { swipe?.cancel(); setPeek(null); }
    if (previous.snapshot !== owner.props.snapshot) animate(shellView(previous.snapshot), next, pending);
    else measure();
    reportFormatterErrors();
    acknowledgePresentation();
    commitFocusRequest();
    // Focus moved by this lifecycle during commit emits no React focus events: reconcile the pause.
    syncFocus(doc.activeElement);
  }
  function componentWillUnmount() {
    swipe?.dispose(); swipe = null;
    peek = null; fling = null;
    announcer.dispose();
    mounted = false;
    cleanup?.(); cleanup = null;
    observer?.disconnect(); observer = null;
    motion?.dispose(); motion = null;
    revealing.clear();
    const sheet = styleRef.current?.sheet;
    if (sheet) while (sheet.cssRules.length) sheet.deleteRule(0);
    rules = {};
    for (const container of [exitRef.current, slideOutRef.current, chromeOutRef.current]) clear(container);
    progressFill = null;
    const active = doc.activeElement;
    if (rootRef.current?.contains(active) && !restoreExternalFocus()) {
      // There is no surviving internal anchor when the entire host is removed.
      (active as HTMLElement | null)?.blur();
    }
  }
  const navigate = (handle: NotificationHandle) => {
    navigating = handle;
    if (bridge.dismiss(lease, handle, 'navigation').status !== 'applied') navigating = null;
  };
  function onIslandKey(event: ReactKeyboardEvent, stack: readonly NotificationHandle[], index: number, rtl: boolean) {
    if (event.defaultPrevented) return;
    let next: number | null = null;
    if (event.key === 'Escape') {
      event.preventDefault();
      bridge.collapseIsland(lease);
      return;
    }
    // A focused scrolling body keeps Home/End for its own scroll.
    if ((event.key === 'Home' || event.key === 'End') && event.target === bodyElement() && bodyElement()?.tabIndex === 0) return;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = stack.length - 1;
    else if (event.key === 'ArrowRight') next = index + (rtl ? -1 : 1);
    else if (event.key === 'ArrowLeft') next = index + (rtl ? 1 : -1);
    const handle = next === null ? undefined : stack[next];
    if (!handle) return;
    event.preventDefault();
    bridge.navigate(lease, handle);
  }
  function render() {
    const { snapshot, options } = owner.props;
    const labels = { ...defaultLabels, ...options.labels };
    const instance = snapshot.controller ?? 'cloudlet';
    const dir = options.dir ?? (doc.documentElement.dir === 'rtl' ? 'rtl' : 'ltr');
    const theme = options.theme ?? 'system';
    rtl = dir === 'rtl';
    const islandId = `${instance}-island`;
    const current = shellView(snapshot);
    const { presented, open, total, index, missed } = current;
    if (current.badge) badgeCount = current.count;
    const preview = open && peek ? snapshot.notifications.find(item => item.handle === peek!.handle) : undefined;
    const position = options.position ?? 'auto';
    const bottom = position === 'bottom-center' || (position === 'auto' && view?.matchMedia?.('(min-width: 48rem)').matches === false);
    const tails = Math.min(2, Math.max(current.depth, heldTails));
    const slot = presented ? slotRenderer(bridge, lease, presented.handle, rejectSlotFocus) : null;
    const page = format(labels.page, defaultLabels.page, index + 1, total);
    const part = partClasses(options.classNames);
    return <>
      {options.offsets && <OffsetStyles key={options.nonce ?? ''} instance={instance} offsets={options.offsets} nonce={options.nonce} />}
      <div ref={rootRef} className={part('host', 'cloudlet-host')} role="region" aria-label={labels.region} tabIndex={-1}
        data-cloudlet-focus-anchor="" data-cloudlet-instance={instance} data-theme={theme}
        data-resolved-theme={theme === 'system' ? view?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : theme}
        data-position={position} data-edge={bottom ? 'bottom' : 'top'} data-state={open ? 'island' : 'stack'}
        data-island-reason={snapshot.island.reason ?? undefined} data-overflow={snapshot.overflow.pending} dir={dir}
        onPointerDownCapture={event => { activation = (event.target as Element).closest('button'); }}
        onPointerCancelCapture={() => { activation = null; }}
        onKeyDownCapture={event => {
          if ((event.key === 'Enter' || event.key === ' ') && (event.target as Element).closest('button')) {
            repeating = event.repeat;
            if (event.repeat) event.preventDefault();
            else activation = (event.target as Element).closest('button');
          }
        }}
        onKeyUpCapture={() => { repeating = false; }}
        onClickCapture={event => {
          const target = (event.target as Element).closest('button');
          // A double click must not fire a one-shot action twice; close, the pill and the dots are
          // repeatable on purpose (each click dismisses or shows another record).
          const oneShot = !!target?.matches('[data-cloudlet-control="action"], [data-cloudlet-control="retry"], [data-cloudlet-control="cancel"]');
          if (target && (repeating || (oneShot && event.detail > 1) || (activation && activation !== target))) { event.preventDefault(); event.stopPropagation(); }
          activation = null;
        }}
        onFocus={event => {
          rememberExternal(event.relatedTarget);
          // A rich slot capture handler can already have redirected this focus.
          syncFocus(doc.activeElement);
        }}
        onBlur={event => syncFocus(view && event.relatedTarget instanceof view.Element ? event.relatedTarget : null)}
        onMouseEnter={() => hover(true)}
        onMouseLeave={() => hover(false)}>
        <style ref={styleRef} nonce={options.nonce} data-cloudlet-motion="" />
        <div ref={stackRef} className={part('stack', 'cloudlet-stack')} data-empty={!presented}>
          {[1, 2].filter(tail => tail <= tails).map(tail => <div key={tail} className={part('tail', 'cloudlet-tail')} data-cloudlet-tail={tail} aria-hidden="true" />)}
          <div ref={shellRef} id={islandId} className={part('island', 'cloudlet-shell')} hidden={!presented} data-state={open ? 'island' : 'stack'}
            data-kind={presented?.kind}
            {...(open ? { role: 'region', 'aria-roledescription': labels.carousel, 'aria-label': labels.island, 'aria-describedby': `${islandId}-hint` } : {})}
            onKeyDown={open ? event => onIslandKey(event, snapshot.stack, index, dir === 'rtl') : undefined}>
            <svg ref={bgRef} className="cloudlet-bg" aria-hidden="true" focusable="false"><path ref={pathRef} /></svg>
            <div ref={clipRef} className="cloudlet-clip">
              <div ref={slideOutRef} className="cloudlet-slide-out" aria-hidden="true" />
              {presented && slot && <div className="cloudlet-slide" data-cloudlet-presented={presented.handle.generation}
                data-kind={presented.kind} data-current="true"
                {...(open ? { role: 'group', 'aria-roledescription': labels.slide, 'aria-label': page } : {})}>
                <div className={part('header', 'cloudlet-header')} aria-hidden={open ? undefined : 'true'}>
                  <Heading notification={presented} slot={slot} part={part} titleId={`${islandId}-title`} />
                  <div className="cloudlet-heading-out" aria-hidden="true" />
                </div>
                {open && <Body notification={presented} bridge={bridge} lease={lease} labels={labels} navigate={navigate} slot={slot} part={part} />}
                <div className="cloudlet-body-out" aria-hidden="true" />
              </div>}
              {preview && <div ref={inertRef} className="cloudlet-peek" aria-hidden="true"><SlidePreview notification={preview} labels={labels} part={part} /></div>}
              {presented && open && closeButton(labels, part, () => bridge.dismiss(lease, presented.handle, 'close-button'))}
              {open && (total > 1 || missed > 0) && <div className={part('indicator', 'cloudlet-indicator')}>{total > 5
                ? <p className="cloudlet-page" aria-hidden="true"><span className="cloudlet-page-value">{page}</span><span className="cloudlet-page-out" /></p>
                : total > 1 && snapshot.stack.map((handle, position) =>
                  <button key={handle.generation} type="button" className="cloudlet-dot-button" aria-current={position === index ? 'true' : undefined}
                    aria-label={format(labels.page, defaultLabels.page, position + 1, total)} onClick={() => bridge.navigate(lease, handle)}>
                    <span className="cloudlet-dot" aria-hidden="true" />
                  </button>)}
                {missed > 0 && <div className={part('overflow', 'cloudlet-overflow')}>
                  <p>{format(labels.overflowCount, defaultLabels.overflowCount, missed)}</p>
                  <button type="button" data-cloudlet-overflow="" onClick={() => bridge.acknowledgeOverflow(lease)}>{labels.acknowledgeOverflow}</button>
                </div>}</div>}
              {open && <span id={`${islandId}-hint`} className="cloudlet-live">{labels.collapse}</span>}
              <div ref={chromeOutRef} className="cloudlet-chrome-out" aria-hidden="true" />
            </div>
            {presented && !open && <button type="button" className={part('pill', 'cloudlet-pill')} data-cloudlet-pill=""
              aria-expanded="false" aria-controls={islandId} onClick={() => bridge.openIsland(lease, 'user')}
              aria-label={format(labels.stackSummary, defaultLabels.stackSummary, presented.content.title, total, missed)} />}
            <span className={part('badge', 'cloudlet-badge')} aria-hidden="true"><span className="cloudlet-badge-value">{badgeCount}</span><span className="cloudlet-badge-out" /></span>
          </div>
          <div ref={exitRef} className="cloudlet-exit" aria-hidden="true" />
        </div>
      </div>
    </>;
  }
  return { componentDidMount, getSnapshotBeforeUpdate, componentDidUpdate, componentWillUnmount, render };
}

/** Changes that can remove or hide a focused control. */
function structure(snapshot: RendererSnapshot<ReactNode>): string {
  const presented = snapshot.notifications.find(item => item.location === 'current');
  return [snapshot.island.open, snapshot.overflow.pending, snapshot.stack.map(handle => handle.generation).join(','),
    presented?.handle.generation, presented?.content.action?.kind, presented?.action.status, presented?.operation?.status,
    presented?.operation?.canRetry, presented?.operation?.canCancel].join('|');
}

/** Only these generated blocks use nonce. No style attribute or cssText is used. */
function OffsetStyles({ instance, offsets, nonce }: { instance: string; offsets: ToasterOffsets; nonce: string | undefined }) {
  const ref = useRef<HTMLStyleElement>(null);
  useLayoutEffect(() => {
    const sheet = ref.current?.sheet;
    if (!sheet) return;
    const index = sheet.insertRule(`[data-cloudlet-instance="${instance}"] {}`);
    const rule = sheet.cssRules[index] as CSSStyleRule;
    for (const group of ['gutter', 'obstruction'] as const) {
      for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
        const value = offsets[group]?.[edge];
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) rule.style.setProperty(`--cloudlet-${group}-${edge}`, `${value}px`);
      }
    }
    return () => { sheet.deleteRule(index); };
  }, [instance, offsets]);
  return <style ref={ref} nonce={nonce} data-cloudlet-offsets={instance} />;
}
