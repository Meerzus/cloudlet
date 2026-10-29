'use client';

import {
  CloudletProvider,
  createCloudlet,
  Toaster,
  type ReactCloudletController,
  type ToasterOffsets,
} from '@cloudlet/toast';
import { useEffect, useState } from 'react';
import {
  isTrustedMessage,
  parseDevice,
  parseParentMessage,
  parseTheme,
  postToParent,
  type FrameTheme,
  type IntroEnd,
} from '@/lib/frame-protocol';
import type { DeviceId, SkeletonKind } from '@/lib/devices';
import { playIntro, type IntroRun } from '@/lib/intro';

function applyTheme(theme: FrameTheme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

const toasterHost = () => document.querySelector('.cloudlet-host');

/**
 * Like a real app, the skeletons' system chrome obstructs an edge: the menu bar (25 px) on
 * the laptop, the tab bar and home indicator (83 px) on the phone, the status bar (24 px) on
 * the tablet and the open foldable.
 */
const OFFSETS: Record<SkeletonKind, ToasterOffsets> = {
  desktop: { obstruction: { top: 25 } },
  mobile: { obstruction: { bottom: 83 } },
  tablet: { obstruction: { top: 24 } },
};
/** The page's own Toaster is "Notifications"; landmarks must stay distinguishable across the iframe. */
const LABELS = { region: 'Demo device notifications' } as const;
/** The foldable's skeleton follows its width (the same breakpoint as the Toaster's `auto`). */
const WIDE = '(min-width: 48rem)';

function skeletonFor(device: DeviceId, wide: boolean): SkeletonKind {
  if (device === 'laptop') return 'desktop';
  if (device === 'phone') return 'mobile';
  if (device === 'tablet') return 'tablet';
  return wide ? 'tablet' : 'mobile';
}

/** True when an element under the pointer can still scroll by `deltaY` itself (a long Island body). */
function scrollsItself(target: EventTarget | null, deltaY: number) {
  for (let node = target instanceof Element ? target : null; node && node !== document.documentElement; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY !== 'auto' && overflowY !== 'scroll') || node.scrollHeight <= node.clientHeight) continue;
    if (deltaY < 0 ? node.scrollTop > 0 : node.scrollTop + node.clientHeight < node.scrollHeight) return true;
  }
  return false;
}

/**
 * The hero screen: its own controller and Toaster in a real viewport, driven by the
 * parent through the typed protocol. Only messages from our origin and from the
 * embedding window are accepted; replies go to that same origin only.
 */
export function FrameApp() {
  const [controller, setController] = useState<ReactCloudletController | null>(null);
  const [theme, setTheme] = useState<FrameTheme>('light');
  const [device, setDevice] = useState<DeviceId>('laptop');
  const [wide, setWide] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setTheme(parseTheme(params.get('theme')));
    setDevice(parseDevice(params.get('device')));
    // The foldable's frame is resized when it folds: its chrome (and offsets) follow the width.
    const media = window.matchMedia(WIDE);
    const sync = () => setWide(media.matches);
    sync();
    media.addEventListener('change', sync);
    const session = createCloudlet();
    setController(session);
    return () => {
      media.removeEventListener('change', sync);
      session.dispose();
    };
  }, []);

  useEffect(() => {
    if (!controller) return;
    const origin = window.location.origin;
    const parent = window.parent === window ? null : window.parent;
    let intro: IntroRun | null = null;

    const report = (reason: IntroEnd) => {
      if (parent) postToParent(parent, { type: 'intro-done', reason }, origin);
    };
    const play = () => {
      intro?.cancel();
      const run = playIntro(controller, toasterHost);
      intro = run;
      void run.done.then((reason) => {
        if (intro !== run) return;
        intro = null;
        report(reason);
      });
    };
    const stop = () => intro?.stop();
    const reset = () => {
      // Detach first: a reset intro reports nothing.
      const run = intro;
      intro = null;
      run?.cancel();
      controller.clear();
    };

    const onMessage = (event: MessageEvent) => {
      if (!isTrustedMessage(event, parent, origin)) return;
      const message = parseParentMessage(event.data);
      if (!message) return;
      switch (message.type) {
        case 'play-intro':
          play();
          break;
        case 'stop-intro':
          stop();
          break;
        case 'reset':
          reset();
          break;
        case 'set-theme':
          applyTheme(message.theme);
          setTheme(message.theme);
          break;
      }
    };
    // Visitor input inside the screen interrupts the intro; the intro's own synthetic events are untrusted.
    const onInput = (event: Event) => {
      if (!event.isTrusted) return;
      if (event instanceof WheelEvent && Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      stop();
    };

    // The screen document never scrolls: a vertical wheel goes to the page (horizontal ones stay
    // here for the Island's trackpad swipe), so the landing keeps scrolling under the pointer.
    const onWheel = (event: WheelEvent) => {
      if (!parent || event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (scrollsItself(event.target, event.deltaY)) return;
      event.preventDefault();
      const deltaMode = event.deltaMode === 1 || event.deltaMode === 2 ? event.deltaMode : 0;
      postToParent(parent, { type: 'wheel', deltaX: event.deltaX, deltaY: event.deltaY, deltaMode }, origin);
    };

    window.addEventListener('message', onMessage);
    window.addEventListener('wheel', onWheel, { passive: false });
    const inputs = ['pointerdown', 'keydown', 'wheel'] as const;
    for (const type of inputs) window.addEventListener(type, onInput, { capture: true, passive: true });
    if (parent) postToParent(parent, { type: 'ready' }, origin);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('wheel', onWheel);
      for (const type of inputs) window.removeEventListener(type, onInput, { capture: true });
      reset();
    };
  }, [controller]);

  if (!controller) return null;
  return (
    <CloudletProvider controller={controller}>
      <Toaster theme={theme} position="auto" offsets={OFFSETS[skeletonFor(device, wide)]} labels={LABELS} />
    </CloudletProvider>
  );
}
