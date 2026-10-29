/**
 * The public package has no imperative open/collapse API: the Island opens from its
 * pill and collapses with Escape or a press outside (DESIGN §1). Lab buttons drive
 * exactly those user paths through the public parts (`classNames` hooks `.cloudlet-pill`,
 * `.cloudlet-close`, the Island region) — no internals.
 */
export function openIsland(host: Element | null): boolean {
  const pill = host?.querySelector<HTMLButtonElement>('.cloudlet-pill');
  pill?.click();
  return Boolean(pill);
}

export function collapseIsland(host: Element | null): boolean {
  const island = host?.querySelector('.cloudlet-shell[role="region"]');
  island?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  return Boolean(island);
}

/** The Island's own close button: the record closes with reason `close-button`. */
export function closeCurrent(host: Element | null): boolean {
  const close = host?.querySelector<HTMLButtonElement>('.cloudlet-close');
  close?.click();
  return Boolean(close);
}

/**
 * A press outside the open Island collapses it. Controls marked `data-lab-keep-island`
 * (scenario, generators, tuning) stop that press before it reaches the document, so the
 * Island can be driven and tuned while it stays open. Clicks and focus are unaffected.
 */
export function keepIslandOnLabControls(view: Window): () => void {
  const listener = (event: Event) => {
    if (event.target instanceof Element && event.target.closest('[data-lab-keep-island]')) event.stopPropagation();
  };
  view.addEventListener('pointerdown', listener, true);
  return () => view.removeEventListener('pointerdown', listener, true);
}
