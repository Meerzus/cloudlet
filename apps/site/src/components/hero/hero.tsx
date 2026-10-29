'use client';

import { Columns2, Laptop, Smartphone, Tablet } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ExternalLink } from '@/components/site/external-link';
import { GitHubMark } from '@/components/site/icons';
import { useMotion } from '@/components/site/motion';
import { usePageNotifications } from '@/components/site/notifications';
import { useTheme } from '@/components/site/theme';
import { useMediaQuery } from '@/components/site/use-media-query';
import { SEGMENT_STYLE, useSegmentIndicator } from '@/components/site/use-segment-indicator';
import {
  createFrameLink,
  frameUrl,
  isTrustedMessage,
  parseFrameMessage,
  postToFrame,
  type ParentMessage,
} from '@/lib/frame-protocol';
import { DEVICE_IDS, type DeviceId, type FoldPose } from '@/lib/devices';
import { playIntro, type IntroRun } from '@/lib/intro';
import { DOCS_PATH, GITHUB_URL, PLAYGROUND_PATH } from '@/lib/site';
import { cn } from '@/lib/utils';
import { DeviceStage, type StageFrame } from './device-stage';
import { FoldToggle } from './fold-toggle';
import { InstallTabs } from './install-tabs';

type FrameLink = ReturnType<typeof createFrameLink>;
type IntroState = 'idle' | 'playing' | 'done';

/** The hero's row of demo controls: using it never interrupts the intro (owner decision, 28.10.2026). */
const CONTROLS_SELECTOR = '.hero-controls';

/** Generic names only: no product names in the interface. */
const DEVICES = {
  laptop: { label: 'Laptop', Icon: Laptop },
  phone: { label: 'Phone', Icon: Smartphone },
  foldable: { label: 'Foldable', Icon: Columns2 },
  tablet: { label: 'Tablet', Icon: Tablet },
} as const;

/** Phone visitors (< 48rem, the Toaster's own breakpoint) get no mockup: the page Toaster is the demo. */
// The hero has no demo chips: trying every kind is the playground's job (owner decision).
const WIDE_QUERY = '(min-width: 48rem)';

const pageToasterHost = () => document.querySelector('.cloudlet-host');

/**
 * A vertical wheel the screen forwarded: replayed as a wheel on the page, so Lenis smooths it
 * exactly like a wheel anywhere else; without Lenis (touch, reduced motion) the page scrolls natively.
 */
function scrollPage(wheel: { deltaX: number; deltaY: number; deltaMode: number }, lenis: unknown) {
  if (lenis) {
    window.dispatchEvent(new WheelEvent('wheel', { ...wheel, cancelable: true }));
    return;
  }
  const unit = wheel.deltaMode === 1 ? 16 : wheel.deltaMode === 2 ? window.innerHeight : 1;
  window.scrollBy({ top: wheel.deltaY * unit, left: 0, behavior: 'instant' });
}
/** Share of the device that must be on screen before the intro starts. */
const INTRO_VISIBLE = 0.6;

export function Hero() {
  const wide = useMediaQuery(WIDE_QUERY);
  const { resolved } = useTheme();
  const { reduced, lenis } = useMotion();
  const page = usePageNotifications();

  const [device, setDevice] = useState<DeviceId>('laptop');
  const [pose, setPose] = useState<FoldPose>('closed');
  const [frames, setFrames] = useState<readonly StageFrame[]>([]);
  const deviceSwitch = useSegmentIndicator(DEVICE_IDS.indexOf(device));

  const section = useRef<HTMLElement>(null);
  const stageArea = useRef<HTMLDivElement>(null);
  const links = useRef<Partial<Record<DeviceId, FrameLink>>>({});
  const iframes = useRef<Partial<Record<DeviceId, HTMLIFrameElement | null>>>({});
  const pageIntro = useRef<IntroRun | null>(null);
  const started = useRef(false);
  // The intro's phase is logic only (never rendered), so it lives in a ref that changes synchronously.
  const intro = useRef<IntroState>('idle');
  const state = useRef({ device, wide, resolved, lenis });
  useEffect(() => {
    state.current = { device, wide, resolved, lenis };
  });

  const link = useCallback((target: DeviceId) => {
    links.current[target] ??= createFrameLink(window.location.origin);
    return links.current[target];
  }, []);
  const send = useCallback((message: ParentMessage) => link(state.current.device).send(message), [link]);

  const finishIntro = useCallback(() => {
    intro.current = 'done';
  }, []);

  /** Plays the intro from an empty screen on the current device; a frame buffers it until ready. */
  const playOnDevice = useCallback(() => {
    intro.current = 'playing';
    send({ type: 'reset' });
    send({ type: 'play-intro' });
  }, [send]);

  // The intro loops (owner decision, 28.10.2026): a run that plays through starts again from an empty
  // stack; an interrupted one stays where the visitor left it.
  const startPageIntro = useCallback(() => {
    if (!page) return;
    const run = playIntro(page, pageToasterHost);
    pageIntro.current = run;
    intro.current = 'playing';
    void run.done.then((reason) => {
      if (pageIntro.current !== run) return;
      pageIntro.current = null;
      if (reason !== 'complete') return finishIntro();
      page.clear();
      startPageIntro();
    });
  }, [page, finishIntro]);

  // First play, once: on wide viewports the laptop loads at once and plays when it is in
  // view (it starts below the fold on most laptops); phones play in the page Toaster.
  useEffect(() => {
    if (started.current || wide === null) return;
    if (!wide) {
      if (!page) return;
      started.current = true;
      startPageIntro();
      return;
    }
    const stage = stageArea.current;
    if (!stage) return;
    started.current = true;
    setFrames([{ device: 'laptop', src: frameUrl('laptop', state.current.resolved) }]);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        if (intro.current !== 'idle') return;
        intro.current = 'playing';
        send({ type: 'play-intro' });
      },
      { threshold: INTRO_VISIBLE },
    );
    observer.observe(stage);
  }, [wide, page, send, startPageIntro]);

  // Phones: the intro lives in the page Toaster. Once the hero has left the screen it is
  // cancelled and cleared, so scene 2 and its puppet own the screen.
  useEffect(() => {
    const element = section.current;
    if (wide !== false || !page || !element) return;
    let seen = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        seen = true;
        return;
      }
      if (!seen) return;
      const run = pageIntro.current;
      pageIntro.current = null;
      run?.cancel();
      page.clear();
      if (intro.current === 'playing') finishIntro();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [wide, page, finishIntro]);

  // Replies from the frames: only our origin and only from the iframe we created.
  useEffect(() => {
    const origin = window.location.origin;
    const onMessage = (event: MessageEvent) => {
      for (const target of DEVICE_IDS) {
        const source = iframes.current[target]?.contentWindow ?? null;
        if (!isTrustedMessage(event, source, origin)) continue;
        const message = parseFrameMessage(event.data);
        if (message?.type === 'ready' && source) {
          // A remounted frame may carry a stale theme in its URL: sync it first.
          postToFrame(source, { type: 'set-theme', theme: state.current.resolved }, origin);
          link(target).connect(source);
        }
        if (message?.type === 'intro-done' && target === state.current.device && intro.current === 'playing') {
          if (message.reason === 'complete') playOnDevice();
          else finishIntro();
        }
        if (message?.type === 'wheel') scrollPage(message, state.current.lenis);
        return;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [link, finishIntro, playOnDevice]);

  // The frames follow the page theme without reloading.
  useEffect(() => {
    for (const target of Object.values(links.current)) target.send({ type: 'set-theme', theme: resolved });
  }, [resolved]);

  const interrupt = useCallback(() => {
    if (intro.current !== 'playing') return;
    if (pageIntro.current) pageIntro.current.stop();
    else send({ type: 'stop-intro' });
    finishIntro();
  }, [send, finishIntro]);

  // Any visitor input in the hero ends the intro where it is.
  useEffect(() => {
    const element = section.current;
    if (!element) return;
    const inControls = (event: Event) => event.target instanceof Element && event.target.closest(CONTROLS_SELECTOR) !== null;
    const onPointer = (event: PointerEvent) => {
      // Touch starts scrolls; a tap still arrives as a click below.
      if (event.isTrusted && event.pointerType !== 'touch' && !inControls(event)) interrupt();
    };
    const onInput = (event: Event) => {
      if (event.isTrusted && !inControls(event)) interrupt();
    };
    element.addEventListener('pointerdown', onPointer, true);
    element.addEventListener('click', onInput, true);
    element.addEventListener('keydown', onInput, true);
    return () => {
      element.removeEventListener('pointerdown', onPointer, true);
      element.removeEventListener('click', onInput, true);
      element.removeEventListener('keydown', onInput, true);
    };
  }, [interrupt]);

  // Switching the device starts the intro on it at once; the screen left behind is emptied.
  const select = (next: DeviceId) => {
    if (next === device) return;
    link(device).send({ type: 'reset' });
    state.current = { ...state.current, device: next };
    setFrames((current) =>
      current.some((frame) => frame.device === next)
        ? current
        : [...current, { device: next, src: frameUrl(next, state.current.resolved) }],
    );
    setDevice(next);
    playOnDevice();
  };

  // Ref callbacks re-run on renders, so only remember the element; the links follow `ready`.
  const onFrame = useCallback((target: DeviceId, element: HTMLIFrameElement | null) => {
    iframes.current[target] = element;
  }, []);

  // Phone-width viewports unmount the frames: buffer again until a remounted frame reports ready.
  useEffect(() => {
    if (wide === false) for (const target of Object.values(links.current)) target.disconnect();
  }, [wide]);

  return (
    <section ref={section} id="hero" aria-labelledby="hero-title" className="relative px-4 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col items-center pb-24 pt-20 text-center sm:pt-28">
        <h1
          id="hero-title"
          className="max-w-4xl text-balance text-5xl font-semibold leading-[1.02] tracking-[-0.04em] sm:text-7xl lg:text-[5.5rem]"
        >
          Notifications, light as a cloud.
        </h1>
        <p className="mt-6 max-w-2xl text-pretty text-lg text-muted-foreground sm:text-xl">
          Cloudlet drifts in, stacks softly and opens into a card when it matters. Every motion on springs, every
          frame interruptible.
        </p>
        <div className="mt-10 flex w-full flex-col items-center gap-5">
          <InstallTabs />
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href={PLAYGROUND_PATH}>Open playground</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href={DOCS_PATH}>Read the docs</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <ExternalLink href={GITHUB_URL}>
                <GitHubMark className="size-5" />
                GitHub
              </ExternalLink>
            </Button>
          </div>
        </div>

        {/* Phones have no mockup and no controls: the page Toaster plays the intro. */}
        <div className="hero-demo mt-16 max-md:hidden">
          <div className="hero-controls">
            <div
              ref={deviceSwitch.group}
              role="group"
              aria-label="Device"
              className="device-switch max-md:hidden"
              style={SEGMENT_STYLE}
            >
              <span ref={deviceSwitch.indicator} aria-hidden="true" className="segment-indicator device-switch-indicator" />
              {DEVICE_IDS.map((id) => {
                const { label, Icon } = DEVICES[id];
                return (
                  <button
                    key={id}
                    type="button"
                    data-segment=""
                    aria-pressed={device === id}
                    onClick={() => select(id)}
                    className={cn('device-switch-option', device === id && 'is-active')}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {label}
                  </button>
                );
              })}
            </div>
            <FoldToggle
              shown={device === 'foldable'}
              pose={pose}
              onToggle={() => setPose((current) => (current === 'open' ? 'closed' : 'open'))}
            />
          </div>
          <div ref={stageArea} className="hero-device w-full max-md:hidden">
            <DeviceStage
              device={device}
              pose={pose}
              finish={resolved}
              frames={wide ? frames : []}
              reduced={reduced}
              onFrame={onFrame}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
