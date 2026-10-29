/**
 * Diagnostic journal for task 17 (owner's browser): pointer and click events that reach the
 * main host, and the controller's semantic events, with timestamps. Read with
 * `copy(window.__cloudletEvents.join('\n'))` in DevTools.
 */
declare global { interface Window { __cloudletEvents?: string[] } }

export function logDebug(text: string) {
  const list = window.__cloudletEvents ??= [];
  list.push(`${Math.round(performance.now())} ${text}`);
  if (list.length > 400) list.splice(0, list.length - 400);
}

/** Capture-phase listeners on the document: logs every pointer/click event whose target lies inside a host. */
export function observeHostInput(): () => void {
  const types = ['pointerdown', 'pointerup', 'pointercancel', 'click', 'wheel'] as const;
  const handler = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    const host = target?.closest('.cloudlet-host');
    if (!host) return;
    const where = target!.closest('.cloudlet-close, .cloudlet-pill, .cloudlet-dot-button, .cloudlet-action, .cloudlet-heading, .cloudlet-body')?.className ?? target!.className;
    const extra = event instanceof WheelEvent ? ` dx=${Math.round(event.deltaX)} dy=${Math.round(event.deltaY)}` : event instanceof PointerEvent ? ` ${event.pointerType} button=${event.button} detail=${event.detail}` : event instanceof MouseEvent ? ` detail=${event.detail}` : '';
    logDebug(`${event.type} ${String(where).split(' ')[0]}${extra} prevented=${event.defaultPrevented} state=${(host as HTMLElement).dataset.state} dragging=${(host as HTMLElement).dataset.dragging ?? '-'}`);
  };
  for (const type of types) document.addEventListener(type, handler, true);
  return () => { for (const type of types) document.removeEventListener(type, handler, true); };
}
