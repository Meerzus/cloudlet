import { MOTION } from './motion.js';

const { swipe } = MOTION;

/**
 * Edge resistance (iOS-style rubber band): the result approaches `dimension`
 * asymptotically and keeps the sign of the raw finger travel.
 */
export function rubberBand(offset: number, dimension: number, coefficient: number = swipe.rubberBand): number {
  if (!Number.isFinite(offset) || !(dimension > 0)) return 0;
  const travel = Math.abs(offset);
  return Math.sign(offset) * (1 - 1 / (travel * coefficient / dimension + 1)) * dimension;
}

/**
 * Release decision along one axis. Returns the sign of the travel when the swipe
 * commits that way (distance past `MOTION.swipe.distance` of `dimension`, or a flick of
 * at least `minDistance` px faster than `velocity` px/ms), 0 when it springs back.
 * A direction without a destination never commits; a flick back always cancels.
 */
export function decideRelease(offset: number, velocity: number, dimension: number,
  allowed: { readonly negative: boolean; readonly positive: boolean }): -1 | 0 | 1 {
  const sign = offset > 0 ? 1 : offset < 0 ? -1 : 0;
  if (!sign || !(sign > 0 ? allowed.positive : allowed.negative)) return 0;
  const toward = Number.isFinite(velocity) ? velocity * sign : 0;
  if (toward < -swipe.velocity) return 0;
  const distance = Math.abs(offset);
  if (dimension > 0 && distance > dimension * swipe.distance) return sign;
  return distance >= swipe.minDistance && toward > swipe.velocity ? sign : 0;
}

export type SwipeAxis = 'x' | 'y';

/** A started swipe along one axis. Offsets are raw finger travel in CSS px. */
export interface SwipeSession {
  readonly move: (offset: number) => void;
  /** Velocity is CSS px/ms along the axis, positive in the direction of positive offsets. */
  readonly end: (offset: number, velocity: number) => void;
  /** Lost capture, a second pointer, orientation change or an external cancel. */
  readonly cancel: () => void;
}

/** What may start from one pointerdown or wheel stream; `release` ends the intent window. */
export interface SwipeCandidate {
  readonly x: boolean;
  readonly y: boolean;
  readonly start: (axis: SwipeAxis) => SwipeSession | null;
  readonly release: () => void;
}

interface SwipeOptions {
  /** Null ignores the input; the candidate is released exactly once. */
  readonly begin: (target: Element, input: 'pointer' | 'wheel') => SwipeCandidate | null;
  readonly now: () => number;
}

interface PointerSwipe {
  readonly pointer: number;
  readonly candidate: SwipeCandidate;
  readonly startX: number;
  readonly startY: number;
  session: SwipeSession | null;
  axis: SwipeAxis | null;
  captured: boolean;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  time: number;
  velocityX: number;
  velocityY: number;
}

interface WheelSwipe {
  readonly candidate: SwipeCandidate | null;
  session: SwipeSession | null;
  /** Committed early: the rest of the stream (macOS momentum) is swallowed until it goes idle. */
  spent: boolean;
  spentAt: number;
  lastDx: number;
  offset: number;
  velocity: number;
  time: number;
  timer: number;
}

const interactive = 'button,a,input,select,textarea,summary,label,[role="button"],[role="link"],[contenteditable]:not([contenteditable="false"])';

/**
 * Pointer and trackpad ownership for one host. The axis is decided by the first
 * `MOTION.swipe.intent` px; an axis the target does not own is given back to the
 * browser (native scroll) for the rest of the gesture. Buttons and links never start
 * a swipe, except the collapsed pill, which is itself the swipe surface. Layout,
 * physics and store commands stay with the caller.
 */
export function createSwipe(root: HTMLElement, options: SwipeOptions) {
  const view = root.ownerDocument.defaultView;
  let current: PointerSwipe | null = null;
  let wheel: WheelSwipe | null = null;
  let suppressUntil = 0;
  let disposed = false;
  if (!view) return { cancel() {}, dispose() {}, get active() { return false; } };

  function finish(): PointerSwipe | null {
    const gesture = current;
    if (!gesture) return null;
    // Lost capture, store updates and callbacks can be synchronous/reentrant:
    // clear ownership before releasing anything.
    current = null;
    delete root.dataset.dragging;
    if (gesture.captured && root.hasPointerCapture?.(gesture.pointer)) root.releasePointerCapture(gesture.pointer);
    gesture.candidate.release();
    return gesture;
  }
  function endWheel(commit: boolean) {
    const stream = wheel;
    if (!stream) return;
    wheel = null;
    view!.clearTimeout(stream.timer);
    if (stream.session) delete root.dataset.dragging;
    stream.candidate?.release();
    if (commit) stream.session?.end(stream.offset, stream.velocity);
    else stream.session?.cancel();
  }
  const cancel = () => {
    finish()?.session?.cancel();
    endWheel(false);
  };
  const secondPointer = (event: PointerEvent) => {
    if (current && event.pointerId !== current.pointer) cancel();
  };
  const down = (event: PointerEvent) => {
    // A new deliberate activation must work even if a previous browser did not
    // generate the compatibility click suppressed after an accepted drag.
    if (disposed || current || !event.isPrimary || event.button !== 0) return;
    suppressUntil = 0;
    const target = event.target;
    if (!(target instanceof view.Element)) return;
    const control = target.closest(interactive);
    if (control && root.contains(control) && !control.matches('[data-cloudlet-pill]')) return;
    endWheel(false);
    const candidate = options.begin(target, 'pointer');
    if (!candidate) return;
    current = {
      pointer: event.pointerId, candidate, startX: event.clientX, startY: event.clientY, session: null, axis: null,
      captured: false, x: 0, y: 0, lastX: event.clientX, lastY: event.clientY, time: event.timeStamp, velocityX: 0, velocityY: 0,
    };
  };
  function sample(gesture: PointerSwipe, event: PointerEvent, release = false) {
    const elapsed = event.timeStamp - gesture.time;
    for (const axis of ['X', 'Y'] as const) {
      const position = axis === 'X' ? event.clientX : event.clientY;
      const last = gesture[`last${axis}`];
      // A pause before lifting the finger is not a flick.
      if (elapsed > 0 && position !== last) gesture[`velocity${axis}`] = (position - last) / elapsed;
      else if (elapsed > 0 && (!release || elapsed > 80)) gesture[`velocity${axis}`] = 0;
      gesture[`last${axis}`] = position;
    }
    gesture.x = event.clientX - gesture.startX;
    gesture.y = event.clientY - gesture.startY;
    gesture.time = event.timeStamp;
  }
  const move = (event: PointerEvent) => {
    const gesture = current;
    if (!gesture || event.pointerId !== gesture.pointer) return;
    sample(gesture, event);
    if (!gesture.session) {
      const horizontal = Math.abs(gesture.x);
      const vertical = Math.abs(gesture.y);
      if (Math.max(horizontal, vertical) < swipe.intent) return;
      // The first directional intent wins; an axis the target does not own stays native.
      const axis: SwipeAxis = horizontal > vertical ? 'x' : 'y';
      const session = gesture.candidate[axis] ? gesture.candidate.start(axis) : null;
      if (!session || current !== gesture) { cancel(); return; }
      gesture.session = session;
      gesture.axis = axis;
      try {
        root.setPointerCapture(gesture.pointer);
        gesture.captured = true;
      } catch { cancel(); return; }
      root.dataset.dragging = axis;
      // A text selection left in the host would turn the next press into native drag and drop.
      const selection = view.getSelection();
      if (selection?.anchorNode && root.contains(selection.anchorNode)) selection.removeAllRanges();
    }
    suppressUntil = options.now() + swipe.suppressClick;
    if (event.cancelable) event.preventDefault();
    gesture.session.move(gesture.axis === 'x' ? gesture.x : gesture.y);
  };
  const up = (event: PointerEvent) => {
    const gesture = current;
    if (!gesture || event.pointerId !== gesture.pointer) return;
    sample(gesture, event, true);
    finish();
    const x = gesture.axis === 'x';
    gesture.session?.end(x ? gesture.x : gesture.y, x ? gesture.velocityX : gesture.velocityY);
  };
  const cancelled = (event: PointerEvent) => {
    if (current?.pointer === event.pointerId) cancel();
  };
  // Touch input is implicitly captured by the pressed element; moving the capture to
  // the host fires a bubbling lostpointercapture there. Only the host's own loss counts.
  const lost = (event: PointerEvent) => {
    if (event.target === root && current?.captured && current.pointer === event.pointerId) cancel();
  };
  // While the host owns a press, the browser must not start selecting or dragging content.
  const native = (event: Event) => { if (current && (event.type === 'dragstart' || current.session)) event.preventDefault(); };
  const click = (event: MouseEvent) => {
    // Keyboard/AT clicks have detail=0 and remain available during any return.
    if (event.detail === 0 || suppressUntil === 0 || options.now() > suppressUntil) return;
    suppressUntil = 0;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const scroll = (event: WheelEvent) => {
    // Pinch zoom (ctrl+wheel) and a running pointer swipe stay untouched.
    if (disposed || current || event.ctrlKey) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientWidth || 1 : 1;
    const dx = event.deltaX * unit;
    const dy = event.deltaY * unit;
    const time = event.timeStamp;
    if (wheel?.spent) {
      // Momentum only decays. A new swipe accelerates or reverses and starts a fresh stream;
      // vertical scrolling stays native.
      const previous = wheel.lastDx;
      const renewed = time - wheel.spentAt > swipe.wheelLock
        && (Math.abs(dx) > Math.abs(previous) * 1.5 + 2 || (dx !== 0 && previous !== 0 && Math.sign(dx) !== Math.sign(previous)));
      if (renewed) endWheel(false);
      else {
        view.clearTimeout(wheel.timer);
        wheel.timer = view.setTimeout(() => endWheel(true), swipe.wheelIdle);
        wheel.lastDx = dx;
        if (Math.abs(dx) >= Math.abs(dy)) event.preventDefault();
        return;
      }
    }
    if (!wheel) {
      const target = event.target;
      const candidate = Math.abs(dx) > Math.abs(dy) && target instanceof view.Element ? options.begin(target, 'wheel') : null;
      const session = candidate?.x ? candidate.start('x') : null;
      if (candidate && !session) candidate.release();
      // A stream that started vertical stays native until it goes idle.
      wheel = { candidate: session ? candidate : null, session, spent: false, spentAt: 0, lastDx: dx, offset: 0, velocity: 0, time, timer: 0 };
    }
    const stream = wheel;
    view.clearTimeout(stream.timer);
    stream.timer = view.setTimeout(() => endWheel(true), swipe.wheelIdle);
    stream.lastDx = dx;
    if (!stream.session) return;
    event.preventDefault();
    // Fingers moving left scroll right (positive deltaX): the content follows the fingers.
    const elapsed = time - stream.time;
    if (elapsed > 0) stream.velocity = -dx / elapsed;
    stream.offset -= dx;
    stream.time = time;
    root.dataset.dragging = 'x';
    stream.session.move(stream.offset);
    // A trackpad swipe commits as soon as its release would: macOS momentum keeps
    // sending wheel events for a second or more, which otherwise holds the preview in place.
    if (decideRelease(stream.offset, stream.velocity, root.clientWidth || 0, { negative: true, positive: true })) {
      const session = stream.session;
      stream.session = null;
      stream.spent = true;
      stream.spentAt = time;
      delete root.dataset.dragging;
      stream.candidate?.release();
      session.end(stream.offset, stream.velocity);
    }
  };
  const listeners: [EventTarget, string, EventListener, boolean][] = [
    [view, 'pointerdown', secondPointer as EventListener, true],
    [root, 'pointerdown', down as EventListener, false],
    [view, 'pointermove', move as EventListener, true],
    [view, 'pointerup', up as EventListener, true],
    [view, 'pointercancel', cancelled as EventListener, true],
    [root, 'lostpointercapture', lost as EventListener, false],
    [root, 'click', click as EventListener, true],
    [root, 'dragstart', native, false],
    [root, 'selectstart', native, false],
    [root, 'wheel', scroll as EventListener, false],
    [view, 'orientationchange', cancel, false],
  ];
  if (view.screen?.orientation) listeners.push([view.screen.orientation, 'change', cancel, false]);
  for (const [target, type, listener, capture] of listeners) target.addEventListener(type, listener, { capture, passive: false });
  return {
    cancel,
    /** True while a pointer or trackpad swipe (or its intent window) owns the input. */
    get active() { return current !== null || wheel?.session != null; },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
      for (const [target, type, listener, capture] of listeners) target.removeEventListener(type, listener, capture);
    },
  };
}
