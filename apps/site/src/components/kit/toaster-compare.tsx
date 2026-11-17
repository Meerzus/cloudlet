'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ScreenSkeleton } from '@/components/frame/frame-skeleton';
import { DeviceShell } from '@/components/hero/device-shell';
import { useMotion } from '@/components/site/motion';
import { useTheme } from '@/components/site/theme';
import {
  COMPARE_FIRST_STEP,
  COMPARE_SIDES,
  COMPARE_STEPS,
  browserClock,
  fitPhones,
  playStep,
  type CompareEvent,
  type CompareStepId,
  type CompareTarget,
  type PhoneFit,
} from '@/lib/compare-scene';
import {
  createFrameLink,
  frameUrl,
  isTrustedMessage,
  parseFrameMessage,
  postToFrame,
  type ParentMessage,
} from '@/lib/frame-protocol';
import { springEasing } from '@/lib/spring';
import { PlainStack, usePlainStack } from './plain-stack';

/** Below this the phones stand one above the other, each showing its lower part. */
const STACKED_QUERY = '(width < 40rem)';
/** Side by side, the phones take at most this share of the window's height. */
const HEIGHT_SHARE = 0.72;
const HEIGHT_LIMIT = 760;
/** The frame (and its JavaScript) loads when the scene is this close to the screen. */
const NEAR = '10% 0px';
/** Share of the phones on screen before the scene plays its first step by itself. */
const FIRST_VISIBLE = 0.6;

/** The buttons' hover and press, on the hero's press spring. */
const PRESS = springEasing({ stiffness: 520, damping: 34 });

/**
 * A vertical wheel the screen forwarded: replayed as a wheel on the page, so Lenis smooths it like a
 * wheel anywhere else; without Lenis (touch, reduced motion) the page scrolls natively.
 */
function scrollPage(wheel: { deltaX: number; deltaY: number; deltaMode: number }, lenis: unknown) {
  if (lenis) {
    window.dispatchEvent(new WheelEvent('wheel', { ...wheel, cancelable: true }));
    return;
  }
  const unit = wheel.deltaMode === 1 ? 16 : wheel.deltaMode === 2 ? window.innerHeight : 1;
  window.scrollBy({ top: wheel.deltaY * unit, left: 0, behavior: 'instant' });
}

function toFrame(event: CompareEvent): ParentMessage {
  switch (event.type) {
    case 'show':
      return { type: 'toast-show', id: event.id, toast: event.toast };
    case 'update':
      return { type: 'toast-update', id: event.id, toast: event.toast };
    case 'dismiss':
      return { type: 'toast-dismiss', id: event.id };
  }
}

/**
 * Two identical phones: a plain stack of toasts on the left, the real Toaster on the right (the
 * `/toaster/frame` screen in an iframe, its own document, so its fixed host measures a real
 * viewport), and one row of buttons that sends every press to both at the same moment. The frame
 * loads as the scene approaches; nothing runs until a press, except one step the first time the
 * phones are on screen.
 */
export function ToasterCompare() {
  const { resolved } = useTheme();
  const { lenis } = useMotion();
  const plain = usePlainStack();

  const phones = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fit, setFit] = useState<(PhoneFit & { stacked: boolean }) | null>(null);

  const link = useMemo(() => (typeof window === 'undefined' ? null : createFrameLink(window.location.origin)), []);
  const ready = useRef(false);
  const pending = useRef<CompareStepId | null>(null);
  const runs = useRef(0);
  const cancels = useRef<(() => void)[]>([]);
  const state = useRef({ resolved, lenis });
  useEffect(() => {
    state.current = { resolved, lenis };
  });

  const frameTarget = useMemo<CompareTarget>(() => ({ apply: (event) => link?.send(toFrame(event)) }), [link]);

  /** One press: both sides at once, and only once the real Toaster is there to receive it. */
  const play = useCallback(
    (id: CompareStepId) => {
      const step = COMPARE_STEPS.find((candidate) => candidate.id === id);
      if (!step) return;
      if (!ready.current) {
        pending.current = id;
        return;
      }
      runs.current += 1;
      cancels.current.push(playStep(step, `r${runs.current}`, [plain.target, frameTarget], browserClock));
    },
    [plain.target, frameTarget],
  );

  useEffect(
    () => () => {
      for (const cancel of cancels.current) cancel();
    },
    [],
  );

  // Fit the phones to the column and the window; resizes only, never per frame.
  useLayoutEffect(() => {
    const element = phones.current;
    if (!element) return;
    const stacked = window.matchMedia(STACKED_QUERY);
    const measure = () => {
      const maxHeight = Math.min(window.innerHeight * HEIGHT_SHARE, HEIGHT_LIMIT);
      const next = fitPhones({ width: element.clientWidth, maxHeight, stacked: stacked.matches });
      setFit((current) =>
        current && current.scale === next.scale && current.shown === next.shown && current.stacked === stacked.matches
          ? current
          : { ...next, stacked: stacked.matches },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    stacked.addEventListener('change', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      stacked.removeEventListener('change', measure);
    };
  }, []);

  // The frame loads as the scene comes near, with the page's theme of that moment; later themes are messages.
  useEffect(() => {
    const element = phones.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        setSrc(frameUrl('phone', state.current.resolved));
      },
      { rootMargin: NEAR },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The first time the phones are on screen (and the tab is in front), one step plays by itself.
  useEffect(() => {
    const element = phones.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || document.visibilityState !== 'visible') return;
        observer.disconnect();
        play(COMPARE_FIRST_STEP);
      },
      { threshold: FIRST_VISIBLE },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [play]);

  // Replies from the frame: only our origin and only from the iframe we created.
  useEffect(() => {
    if (!link) return;
    const origin = window.location.origin;
    const onMessage = (event: MessageEvent) => {
      const source = iframe.current?.contentWindow ?? null;
      if (!isTrustedMessage(event, source, origin) || !source) return;
      const message = parseFrameMessage(event.data);
      if (message?.type === 'ready') {
        postToFrame(source, { type: 'set-theme', theme: state.current.resolved }, origin);
        link.connect(source);
        ready.current = true;
        const waiting = pending.current;
        pending.current = null;
        if (waiting) play(waiting);
      }
      if (message?.type === 'wheel') scrollPage(message, state.current.lenis);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [link, play]);

  useEffect(() => {
    link?.send({ type: 'set-theme', theme: resolved });
  }, [link, resolved]);

  const style = fit ? ({ '--kt-scale': fit.scale, '--kt-shown': fit.shown } as CSSProperties) : undefined;

  return (
    <div className="kt-compare" style={{ '--press-ease': PRESS.easing, '--press-duration': `${PRESS.duration}ms` } as CSSProperties}>
      <div role="group" aria-label="Send to both phones" className="kt-controls">
        {COMPARE_STEPS.map((step) => (
          <button key={step.id} type="button" className="kt-control kit-press" onClick={() => play(step.id)}>
            {step.label}
          </button>
        ))}
      </div>
      <div
        ref={phones}
        className="kt-phones"
        style={style}
        data-fit={fit ? '' : undefined}
        data-stacked={fit?.stacked ? '' : undefined}
      >
        <figure className="kt-side">
          <figcaption className="kt-caption">
            <span className="kt-caption-label">{COMPARE_SIDES.plain.label}</span>
            <span className="kt-caption-note">{COMPARE_SIDES.plain.note}</span>
          </figcaption>
          <div className="kt-slot">
            <div className="kt-device">
              <DeviceShell shell="phone" finish={resolved}>
                <ScreenSkeleton kind="mobile" />
                <PlainStack items={plain.items} />
              </DeviceShell>
            </div>
          </div>
          <p role="status" className="sr-only">
            {plain.said ? `${COMPARE_SIDES.plain.label}: ${plain.said}` : ''}
          </p>
        </figure>
        <figure className="kt-side" data-side="toaster">
          <figcaption className="kt-caption">
            <span className="kt-caption-label">{COMPARE_SIDES.toaster.label}</span>
            <span className="kt-caption-note">{COMPARE_SIDES.toaster.note}</span>
          </figcaption>
          <div className="kt-slot">
            <div className="kt-device">
              <DeviceShell shell="phone" finish={resolved}>
                <ScreenSkeleton kind="mobile" />
                {src ? (
                  <iframe
                    ref={iframe}
                    src={src}
                    title="Toaster, live on a phone"
                    className="kt-frame"
                    data-visible={loaded ? '' : undefined}
                    onLoad={() => setLoaded(true)}
                    width={402}
                    height={874}
                  />
                ) : null}
              </DeviceShell>
            </div>
          </div>
        </figure>
      </div>
    </div>
  );
}
