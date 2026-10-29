export type MotionPreference = 'system' | 'reduce' | 'full';

/** Browser-environment emulation for this lab only. No renderer/controller internals. */
export function installMotionPreference() {
  const original = window.matchMedia;
  const native = original.call(window, '(prefers-reduced-motion: reduce)');
  let preference: MotionPreference = 'system';
  const query = new EventTarget();
  let previous = native.matches;
  const matches = () => preference === 'system' ? native.matches : preference === 'reduce';
  const media = {
    media: native.media, get matches() { return matches(); }, onchange: null,
    addEventListener: query.addEventListener.bind(query), removeEventListener: query.removeEventListener.bind(query),
    dispatchEvent: query.dispatchEvent.bind(query),
    addListener: (listener: (event: Event) => void) => query.addEventListener('change', listener),
    removeListener: (listener: (event: Event) => void) => query.removeEventListener('change', listener),
  } satisfies MediaQueryList;
  const notify = () => {
    const next = matches(); if (next === previous) return; previous = next;
    query.dispatchEvent(new MediaQueryListEvent('change', { matches: next, media: native.media }));
  };
  const adapter: typeof window.matchMedia = value => value === native.media || value === '(prefers-reduced-motion: reduce)' ? media : original.call(window, value);
  window.matchMedia = adapter;
  native.addEventListener('change', notify);
  return {
    set(value: MotionPreference) { preference = value; notify(); },
    dispose() { native.removeEventListener('change', notify); if (window.matchMedia === adapter) window.matchMedia = original; },
  };
}
