'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { Puppet } from '@/components/puppets/puppet';
import { CloudImage } from '@/components/site/sky';
import { useMotion } from '@/components/site/motion';
import { gsap, ScrollTrigger } from '@/lib/gsap';
import {
  LIFE_CAMERA,
  LIFE_CAPTIONS,
  LIFE_DRIFT,
  LIFE_PIN_SCREENS,
  LIFE_SCRUB,
  LIFE_SNAP,
  LIFE_STATES,
  LIFE_STEPS,
} from '@/lib/life-scene';
import { Puppeteer } from '@/lib/puppeteer';
import { lifeBridge } from '@/lib/scene-bridge';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/** The plateau state shown in the reduced-motion sequence and its caption. */
const PLATEAUS = LIFE_STEPS.filter((step) => step.label).map((step) => ({
  state: step.state,
  caption: LIFE_CAPTIONS.find((caption) => caption.id === step.label)!,
}));

export function LifeScene() {
  const { reduced } = useMotion();
  return (
    <section id="life" aria-labelledby="life-title" className="life relative">
      <div className="mx-auto max-w-6xl px-4 pt-24 sm:px-6 sm:pt-32">
        <h2 id="life-title" className="text-balance text-4xl font-semibold tracking-[-0.03em] sm:text-6xl">
          Life of a notification
        </h2>
        <p className="mt-4 max-w-2xl text-pretty text-lg text-muted-foreground sm:text-xl">
          One toast, from a soft landing to a promise kept.
        </p>
      </div>
      {reduced ? <LifeSequence /> : <LifePinned />}
    </section>
  );
}

/** Reduced motion (LANDING §10): no pin, no scrub — the ten plateaus as a still sequence. */
function LifeSequence() {
  return (
    <ol className="life-sequence mx-auto max-w-6xl px-4 pb-24 sm:px-6">
      {PLATEAUS.map(({ state, caption }, index) => (
        <li key={caption.id} className="life-sequence-row">
          <div className="life-caption-static">
            <span className="life-step">{String(index + 1).padStart(2, '0')}</span>
            <h3>{caption.title}</h3>
            <p>{caption.text}</p>
          </div>
          <StillPuppet state={state} />
        </li>
      ))}
    </ol>
  );
}

function StillPuppet({ state }: { state: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = LIFE_STATES[state]!;
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const puppet = new Puppeteer(root, [shown]);
    const draw = () => {
      puppet.measure();
      puppet.set(0, 0.5);
      root.style.height = `${puppet.height}px`;
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(root.parentElement ?? root);
    return () => observer.disconnect();
  }, [shown]);
  return (
    <div className="life-still">
      <Puppet ref={ref} states={[shown]} />
    </div>
  );
}

function LifePinned() {
  const pin = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const camera = useRef<HTMLDivElement>(null);
  const puppet = useRef<HTMLDivElement>(null);
  const cloud = useRef<HTMLDivElement>(null);
  const captions = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!pin.current || !stage.current || !camera.current || !puppet.current || !cloud.current || !captions.current) return;
    const stageEl = stage.current;
    const cameraEl = camera.current;
    const cloudEl = cloud.current;
    const captionEls = [...captions.current.children] as HTMLElement[];
    const puppeteer = new Puppeteer(puppet.current, LIFE_STATES);
    const script = puppeteer.script(LIFE_STEPS);
    const total = script.duration + LIFE_DRIFT;

    // Each hold shows the caption of its label; unlabeled holds keep the previous one.
    let captionIndex = 0;
    const holds = script.holds.map((hold) => {
      const found = LIFE_CAPTIONS.findIndex((caption) => caption.id === hold.label);
      if (found >= 0) captionIndex = found;
      return { ...hold, caption: captionIndex };
    });

    let view = { desktop: true, width: 0, height: 0 };
    const remeasure = () => {
      puppeteer.measure();
      view = {
        desktop: window.innerWidth >= LIFE_CAMERA.minWidth,
        width: stageEl.clientWidth,
        height: stageEl.clientHeight,
      };
    };
    remeasure();

    /** Camera per state: scale and the shell height it frames (centred in the stage). */
    const shot = (state: number) => {
      const pose = puppeteer.pose(state);
      if (!view.desktop) return { scale: 1, h: pose.h };
      const fit = Math.min(LIFE_CAMERA.island, (view.width * 0.94) / Math.max(1, puppeteer.pose(4).w));
      return { scale: pose.mode === 'pill' ? fit * (LIFE_CAMERA.pill / LIFE_CAMERA.island) : fit, h: pose.h };
    };

    /** Where t falls: inside hold k (local 0..1), or moving from hold k to k + 1. */
    const locate = (t: number) => {
      for (let index = 0; index < holds.length; index += 1) {
        const hold = holds[index]!;
        if (t <= hold.end) {
          if (t >= hold.start || index === 0) return { from: index, to: index, p: 1 };
          const previous = holds[index - 1]!;
          return { from: index - 1, to: index, p: (t - previous.end) / (hold.start - previous.end) };
        }
      }
      return { from: holds.length - 1, to: holds.length - 1, p: 1 };
    };

    const pinEl = pin.current;
    const render = (t: number) => {
      // Timeline position for recordings and checks (scripts/record-life.mjs).
      pinEl.dataset.t = t.toFixed(3);
      script.render(Math.min(t, script.duration));
      const at = locate(Math.min(t, script.duration));
      const from = holds[at.from]!;
      const to = holds[at.to]!;
      const a = shot(from.state);
      const b = shot(to.state);
      const k = smooth(at.p);
      const scale = lerp(a.scale, b.scale, k);
      const h = lerp(a.h, b.h, k);

      // Finale: the stack rises, softens and hands over to a cloud (LANDING §7, state 10).
      const drift = clamp01((t - script.duration) / LIFE_DRIFT);
      const rise = smooth(drift);
      const lift = -rise * view.height * 0.42;
      gsap.set(cameraEl, {
        y: -(h * scale) / 2 + lift,
        scale: scale * (1 - 0.12 * rise),
        opacity: 1 - smooth(drift / 0.55),
        filter: drift > 0 ? `blur(${(12 * smooth(drift / 0.7)).toFixed(2)}px)` : 'none',
      });
      const cloudIn = smooth((drift - 0.1) / 0.35);
      const cloudOut = smooth((drift - 0.6) / 0.4);
      gsap.set(cloudEl, {
        y: lift * 1.25 - view.height * 0.04,
        scale: lerp(0.55, 1.15, rise),
        opacity: cloudIn * (1 - cloudOut),
      });
      lifeBridge.drift({ progress: drift, rect: drift > 0 && drift < 1 ? cloudEl.getBoundingClientRect() : null });

      // Captions: blur-swap at the middle of each transition between two captions; the last one
      // leaves with the cloud, so the frame is empty before scene 3 rides up over it.
      // Opacity only, never visibility: every caption stays in the accessibility tree, in order (as in scene 3).
      const shown = from.caption === to.caption ? null : at.p;
      const leave = smooth((drift - 0.6) / 0.4);
      captionEls.forEach((element, index) => {
        let opacity = 0;
        let offset = 0;
        if (shown === null && leave > 0) {
          opacity = index === to.caption ? 1 - leave : 0;
          offset = -8 * leave;
        } else if (shown === null) opacity = index === to.caption ? 1 : 0;
        else if (index === from.caption) {
          const out = smooth(shown / 0.5);
          opacity = 1 - out;
          offset = -8 * out;
        } else if (index === to.caption) {
          const into = smooth((shown - 0.5) / 0.5);
          opacity = into;
          offset = 8 * (1 - into);
        }
        gsap.set(element, {
          opacity,
          y: offset,
          filter: opacity > 0 && opacity < 1 ? `blur(${(6 * (1 - opacity)).toFixed(2)}px)` : 'none',
        });
      });
    };

    const context = gsap.context(() => {
      const driver = { t: 0 };
      const timeline = gsap.timeline();
      timeline.to(driver, { t: total, duration: total, ease: 'none', onUpdate: () => render(driver.t) }, 0);
      timeline.addLabel('start', 0);
      for (const [label, at] of script.labels) timeline.addLabel(label, at);
      timeline.addLabel('end', total);
      pinEl.dataset.labels = JSON.stringify(timeline.labels);
      render(0);

      const trigger = ScrollTrigger.create({
        trigger: pin.current,
        start: 'top top',
        end: () => `+=${window.innerHeight * LIFE_PIN_SCREENS}`,
        pin: true,
        scrub: LIFE_SCRUB,
        animation: timeline,
        invalidateOnRefresh: true,
        snap: { snapTo: 'labelsDirectional', ...LIFE_SNAP },
      });
      const onRefresh = () => {
        remeasure();
        render(driver.t);
      };
      ScrollTrigger.addEventListener('refresh', onRefresh);
      lifeBridge.publish({ timeline, trigger, driftStart: script.duration });
      return () => {
        ScrollTrigger.removeEventListener('refresh', onRefresh);
        lifeBridge.publish(null);
      };
    }, pinEl);
    return () => context.revert();
  }, []);

  return (
    <div ref={pin} className="life-pin">
      <div className="life-frame mx-auto max-w-6xl px-4 sm:px-6">
        <ol ref={captions} className="life-captions">
          {LIFE_CAPTIONS.map((caption, index) => (
            <li key={caption.id} className="life-caption">
              <span className="life-step">{String(index + 1).padStart(2, '0')}</span>
              <h3>{caption.title}</h3>
              <p>{caption.text}</p>
            </li>
          ))}
        </ol>
        <div ref={stage} className="life-stage" aria-hidden="true">
          <div ref={cloud} className="life-cloud">
            <CloudImage shape={5} theme="day" w={26} />
            <CloudImage shape={5} theme="night" w={26} />
          </div>
          <div ref={camera} className="life-camera">
            <Puppet ref={puppet} states={LIFE_STATES} />
          </div>
        </div>
      </div>
    </div>
  );
}
