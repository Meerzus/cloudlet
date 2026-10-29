'use client';

import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { Puppet } from '@/components/puppets/puppet';
import { useMotion } from '@/components/site/motion';
import { CloudImage } from '@/components/site/sky';
import { useMediaQuery } from '@/components/site/use-media-query';
import { CLOUD_SHAPES } from '@/lib/clouds.generated';
import {
  BENEFITS,
  BENEFIT_TEXT_SIDES,
  DRIFT_ANNOUNCEMENT,
  DRIFT_CLOUDS,
  DRIFT_CROWD_DIM,
  DRIFT_LAYERS,
  DRIFT_PHONE_LAYERS,
  DRIFT_PHONE_RECEDE,
  DRIFT_PHONE_STORIES,
  DRIFT_PUPPETS,
  DRIFT_RATE,
  DRIFT_STORIES,
  DRIFT_VOLLEY_START,
  type DriftPuppet,
  type DriftSide,
} from '@/lib/drift-scene';
import {
  STORY_TIMING,
  benefitAt,
  buildDriftTimeline,
  dimAt,
  volleyLeftAt,
  fadeAt,
  hintAt,
  placeAt,
  puppetAt,
  smooth,
  storyCast,
  type Anchor,
} from '@/lib/drift-story';
import { gsap, ScrollTrigger } from '@/lib/gsap';
import { LIFE_SCRUB } from '@/lib/life-scene';
import { Puppeteer } from '@/lib/puppeteer';
import { lifeBridge } from '@/lib/scene-bridge';

const PHONE = '(max-width: 47.99rem)';
const ASPECT = new Map<number, number>(CLOUD_SHAPES.map((shape) => [shape.id, shape.aspect]));

/** Width of a puppet's content (the Island), px: actors are scaled to fit beside the text. */
const ISLAND_WIDTH = 416;
/** Actors take half the screen opposite the text, up to this scale. */
const STAGE_SCALE = 1.25;
/** Below this scale there is no room beside the text (narrow windows): actors play above it instead. */
const STAGE_MIN_SCALE = 0.85;
/** The text block sits this far below the pin's centre (its plates have 4rem of top padding), px. */
const TEXT_OFFSET = 32;
/** Centre of a pill below the puppet's top edge, px (the flight's transform origin). */
const PILL_CENTRE = 22;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
const power2Out = (t: number) => 1 - (1 - clamp01(t)) ** 2;
const power3Out = (t: number) => 1 - (1 - clamp01(t)) ** 3;
const power2InOut = (value: number) => {
  const t = clamp01(value);
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
};
/** Wraps a top edge into [-margin, height + margin): items leave at the top and come back from below, off-screen. */
const wrap = (top: number, height: number, margin: number) => {
  const period = height + 2 * margin;
  return ((((top + margin) % period) + period) % period) - margin;
};

const step = (index: number) => String(index + 1).padStart(2, '0');

/** Last values written per element: a frame only touches styles that changed (most of the crowd rests). */
const written = new WeakMap<HTMLElement, Record<string, string>>();
function put(element: HTMLElement, values: Record<string, string>) {
  const last = written.get(element) ?? {};
  for (const [name, value] of Object.entries(values)) {
    if (last[name] === value) continue;
    element.style.setProperty(name, value);
    last[name] = value;
  }
  written.set(element, last);
}

/**
 * The browser jumps to a URL hash before the pinned scenes add their scroll length, so a link
 * like /#drifting lands inside scene 2. Scene 3 is built last: jump again, once, if that happens
 * within the first seconds of the page load (later, the visitor is already scrolling).
 */
let hashSettled = false;
function settleHash() {
  if (hashSettled) return;
  hashSettled = true;
  const id = decodeURIComponent(window.location.hash.slice(1));
  const target = id ? document.getElementById(id) : null;
  if (!target || window.performance.now() > 10_000) return;
  ScrollTrigger.refresh();
  window.scrollTo(0, target.getBoundingClientRect().top + window.scrollY);
}

export function DriftScene() {
  const { reduced } = useMotion();
  return (
    <section id="drifting" aria-labelledby="drifting-title" className="drift relative">
      {reduced ? <BenefitList /> : <DriftPinned />}
    </section>
  );
}

const TITLE = 'Drifting by';
const LEAD = 'Six reasons it feels this light.';

/** Reduced motion: no volley, no parallax, no pin — the benefits as still text. */
function BenefitList() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-24 sm:px-6 sm:pt-32">
      <h2 id="drifting-title" className="text-balance text-4xl font-semibold tracking-[-0.03em] sm:text-6xl">
        {TITLE}
      </h2>
      <p className="mt-4 max-w-2xl text-pretty text-lg text-muted-foreground sm:text-xl">{LEAD}</p>
      <ol className="benefit-list">
        {BENEFITS.map((benefit, index) => (
          <li key={benefit.id} className="benefit-static">
            <span className="benefit-step">{step(index)} / {step(BENEFITS.length - 1)}</span>
            <h3>{benefit.title}</h3>
            <p>{benefit.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Seconds of the volley: the last puppet has settled by then. */
const volleyLength = (puppets: readonly DriftPuppet[]) => Math.max(...puppets.map((puppet) => puppet.delay + puppet.duration * 1.1));

function DriftPinned() {
  const phone = useMediaQuery(PHONE);
  const pin = useRef<HTMLDivElement>(null);
  const plates = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const puppets = useMemo(() => (phone === null ? [] : DRIFT_PUPPETS.filter((puppet) => !phone || puppet.phone)), [phone]);
  const clouds = phone === null ? [] : DRIFT_CLOUDS.filter((cloud) => !phone || cloud.phone);
  const timeline = useMemo(
    () => (phone === null ? null : buildDriftTimeline(puppets, phone ? DRIFT_PHONE_STORIES : DRIFT_STORIES, phone)),
    [phone, puppets],
  );

  useEffect(() => {
    if (!timeline || phone === null || !pin.current || !plates.current || !layer.current) return;
    const pinEl = pin.current;
    const platesEl = plates.current;
    const layerEl = layer.current;
    const story = timeline;
    let teardown: (() => void) | null = null;
    let generation = 0;
    const off = lifeBridge.onScene((life) => {
      teardown?.();
      teardown = null;
      const current = (generation += 1);
      // Scene 2 publishes from inside its own gsap.context: build ours after it returns, not nested in it.
      if (life) queueMicrotask(() => current === generation && (teardown = build()));
    });

    /** Built after scene 2, so its pin spacing is measured first on every refresh. */
    function build() {
      const T = STORY_TIMING;
      const layers = phone ? DRIFT_PHONE_LAYERS : DRIFT_LAYERS;
      const layerIndex = (puppet: DriftPuppet) => (phone ? Math.min(puppet.layer, 1) : puppet.layer);
      const slots = [...layerEl.querySelectorAll<HTMLElement>('.drift-slot')];
      const cloudEls = [...layerEl.querySelectorAll<HTMLElement>('.drift-cloud')];
      const keyEls = [...layerEl.querySelectorAll<HTMLElement>('.drift-key')];
      const propEls = [...layerEl.querySelectorAll<HTMLElement>('.drift-prop')];
      const volleySeconds = volleyLength(puppets);
      const items = puppets.map((def, index) => {
        const slot = slots[index]!;
        const flight = slot.firstElementChild as HTMLElement;
        const track = story.actors.get(def.id)!;
        return {
          def,
          index,
          slot,
          flight,
          track,
          puppeteer: new Puppeteer(flight.querySelector<HTMLElement>('.puppet')!, track.states),
          layer: layers[layerIndex(def)]!,
          rest: phone && def.phone ? def.phone : { x: def.x, y: def.y },
          /** Puppet seconds of the in-flight morph (pill → Island), 0 without one. */
          morph: 0,
          top: 0,
          height: 0,
          parallax: 0,
          drawn: '',
          setY: gsap.quickSetter(slot, 'y', 'px') as (value: number) => void,
        };
      });
      const sky = cloudEls.map((element, index) => ({
        element,
        def: clouds[index]!,
        top: 0,
        height: 0,
        setY: gsap.quickSetter(element, 'y', 'px') as (value: number) => void,
      }));

      let vw = window.innerWidth;
      let vh = window.innerHeight;
      /** Stage places on either half (pill centres; `tops` per benefit), the scale actors take there, half the text column. */
      const stage = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 }, scale: 1, half: 0, tops: [] as number[] };
      const stories = phone ? DRIFT_PHONE_STORIES : DRIFT_STORIES;
      /** No room beside the text (phones, narrow windows): one stage above it. */
      let compact = phone;
      const spot = (side: DriftSide, benefit: number) => {
        const at = compact ? stage.left : stage[side];
        return compact ? at : { x: at.x, y: (stage.tops[benefit] ?? at.y) + PILL_CENTRE * stage.scale };
      };
      const measure = () => {
        vw = window.innerWidth;
        vh = window.innerHeight;
        for (const item of items) {
          item.puppeteer.measure();
          item.morph = item.def.states.length === 2 ? item.puppeteer.duration(0, 1) : 0;
          item.drawn = '';
          item.height = item.puppeteer.pose(item.track.rest).h;
          item.top = (item.rest.y / 100) * vh - item.height / 2;
          item.slot.style.left = `${item.rest.x}vw`;
          item.slot.style.top = `${item.top}px`;
        }
        for (const cloud of sky) {
          const w = (cloud.def.w / 100) * vw * (phone ? 1.6 : 1);
          cloud.height = w / (ASPECT.get(cloud.def.shape) ?? 2);
          cloud.top = (cloud.def.y / 100) * vh - cloud.height / 2;
          cloud.element.style.top = `${cloud.top}px`;
        }
        // The text takes one half, the actors the other: they play in the middle of their half.
        const sided = Math.min(STAGE_SCALE, (vw / 2 - 96) / ISLAND_WIDTH);
        compact = phone || sided < STAGE_MIN_SCALE;
        pinEl.toggleAttribute('data-compact', compact);
        stage.half = compact ? 0 : platesEl.clientWidth / 2;
        if (compact) {
          // One stage above the text (which then sits below the centre), like on phones.
          stage.scale = Math.min(phone ? 1 : 0.9, (vw - 32) / ISLAND_WIDTH);
          stage.left = { x: vw / 2, y: vh * 0.2 };
        } else {
          stage.scale = sided;
          stage.left = { x: vw * 0.25, y: vh * 0.36 };
          stage.right = { x: vw * 0.75, y: vh * 0.36 };
        }
        // Each benefit's actors are centred on the text by their tallest state: a collapsed pill sits
        // at the top of that box, the open Island fills it.
        const centre = platesEl.getBoundingClientRect().height / 2 + TEXT_OFFSET;
        stage.tops = stories.map((story) => {
          const tallest = Math.max(
            ...storyCast(story).map((id) => {
              const item = items.find((entry) => entry.def.id === id);
              return item ? Math.max(...item.track.states.map((_, index) => item.puppeteer.pose(index).h)) : 0;
            }),
          );
          return centre - (tallest * stage.scale) / 2;
        });
        // Keys sit above the actor; the field above the stage, the announcement under the pill.
        keyEls.forEach((element, index) => {
          const hint = story.keys[index]!;
          const at = spot(hint.side, hint.benefit);
          element.style.left = `${at.x}px`;
          element.style.top = `${at.y - 58 * stage.scale}px`;
        });
        propEls.forEach((element, index) => {
          const show = story.props[index]!;
          const at = spot(show.side, show.benefit);
          element.style.left = `${at.x}px`;
          element.style.top = `${show.prop === 'field' ? at.y - 92 * stage.scale : at.y + 40 * stage.scale}px`;
          element.style.setProperty('--scale', String(stage.scale));
        });
      };

      /** Off-screen launch point of a puppet, relative to where it comes to rest. */
      const launch = (item: (typeof items)[number]) => {
        const x = (item.rest.x / 100) * vw;
        const y = (item.rest.y / 100) * vh;
        // Deterministic spread (recordings repeat exactly): -1..1 per puppet.
        const spread = (((item.index * 37) % 11) - 5) / 5;
        const reach = phone ? 260 : 380;
        switch (item.def.from) {
          case 'left':
            return { x: -(x + reach), y: spread * vh * 0.14 };
          case 'right':
            return { x: vw - x + reach, y: spread * vh * 0.14 };
          case 'top':
            return { x: spread * vw * 0.1, y: -(y + item.height + 160) };
          case 'bottom':
            return { x: spread * vw * 0.1, y: vh - y + item.height + 160 };
        }
      };
      /**
       * Off-screen point the final exit heads for: always sideways, to the puppet's own half — left
       * half to the left, right half to the right — even for puppets that came in from the top or
       * the bottom (owner, 28.10.2026).
       */
      const departure = (item: (typeof items)[number]) => {
        const x = (item.rest.x / 100) * vw;
        const spread = (((item.index * 37) % 11) - 5) / 5;
        const reach = phone ? 260 : 380;
        const y = spread * vh * 0.14;
        return item.track.side === 'left' ? { x: -(x + reach), y } : { x: vw - x + reach, y };
      };

      const state = { volley: 0, t: 0, scroll: window.scrollY };
      /** Parallax counts from where the volley starts. */
      let volleyTrigger: ScrollTrigger | null = null;

      const parallax = () => {
        const travel = Math.max(0, state.scroll - (volleyTrigger?.start ?? state.scroll)) * DRIFT_RATE;
        for (const item of items) {
          const margin = item.height * 1.5 + 40;
          item.parallax = wrap(item.top - travel * item.layer.depth, vh, margin) - item.top;
          item.setY(item.parallax);
        }
        for (const cloud of sky) {
          const margin = cloud.height + 40;
          cloud.setY(wrap(cloud.top - travel * cloud.def.depth, vh, margin) - cloud.top);
        }
      };

      /** Pill centre of an anchor, viewport px. */
      const anchorAt = (item: (typeof items)[number], anchor: Anchor) => {
        const crowd = { x: (item.rest.x / 100) * vw, y: item.top + PILL_CENTRE + item.parallax };
        if (anchor.kind === 'crowd') return { ...crowd, stage: 0 };
        if (anchor.kind === 'below') return { x: crowd.x, y: vh + 120, stage: 0 };
        return { ...spot(anchor.side, anchor.benefit), stage: 1 };
      };

      const drawPuppet = (item: (typeof items)[number], volley: number) => {
        const now = puppetAt(item.track, state.t);
        let key: string;
        if ('move' in now) {
          key = `m${item.track.moves.indexOf(now.move)}:${now.time.toFixed(4)}`;
          if (key !== item.drawn) item.puppeteer.renderStep(now.move.from, now.move.to, now.time, now.move.via);
        } else if (now.state === item.track.rest && item.morph > 0) {
          // Before its story, a puppet that morphs in flight follows the volley.
          const time = clamp01((volley - (item.def.delay + item.def.duration * 0.3)) / (item.morph * 1.25)) * item.morph;
          key = `v${time.toFixed(4)}`;
          if (key !== item.drawn) item.puppeteer.render(0, 1, time);
        } else {
          key = `s${now.state}`;
          if (key !== item.drawn) item.puppeteer.set(now.state);
        }
        item.drawn = key;
      };

      const plateEls = [...platesEl.querySelectorAll<HTMLElement>('.benefit')];
      const windows = [story.intro, ...story.benefits];

      const render = () => {
        const { t } = state;
        // After the last benefit the volley plays backwards: the same flight out, over the same scroll.
        const volley = Math.min(state.volley, volleyLeftAt(story, t)) * volleySeconds;
        pinEl.dataset.t = t.toFixed(3);
        layerEl.dataset.volley = state.volley.toFixed(3);

        // Text: opacity only, never visibility — every plateau stays in the accessibility tree, in order.
        // Between benefits the text moves across to the other half and changes on the way.
        plateEls.forEach((element, index) => {
          const w = windows[index]!;
          const into = smooth((t - w.textIn[0]) / (w.textIn[1] - w.textIn[0]));
          const out = smooth((t - w.textOut[0]) / (w.textOut[1] - w.textOut[0]));
          const opacity = into * (1 - out);
          const benefit = index > 0 ? story.benefits[index - 1]! : null;
          const towards = (side: DriftSide) => (side === 'left' ? 1 : -1) * stage.half;
          // It comes from where the previous text was (the centre after the title) and leaves towards the next one.
          const sided = benefit !== null && stage.half > 0;
          const next = benefit ? story.benefits[index] : undefined;
          const from = sided ? towards(benefit.textSide) * (index === 1 ? 0.5 : 1) : 0;
          const to = sided && next ? towards(benefit.textSide) : 0;
          // The title, the last benefit and the compact layout rise and sink instead.
          const rise = sided ? 0 : 56 * (1 - into);
          const sink = sided && next ? 0 : 56 * out;
          put(element, {
            opacity: opacity.toFixed(3),
            transform: `translate(${(from * (1 - into) + to * out).toFixed(1)}px, ${(rise - sink).toFixed(1)}px)`,
            filter: opacity > 0 && opacity < 1 ? `blur(${(10 * (1 - opacity)).toFixed(1)}px)` : 'none',
          });
        });

        const dim = dimAt(story, t);
        const textSide = stage.half > 0 ? benefitAt(story, t)?.textSide : undefined;
        // Phones write across the whole width, so the settled crowd recedes behind the text there.
        const recede = phone ? lerp(1, DRIFT_PHONE_RECEDE, smooth(t / T.intro.enter) * (1 - smooth((t - story.exit) / T.intro.enter))) : 1;
        for (const item of items) {
          const { def, layer } = item;
          // The volley: flying in from the edge, then settling into the layer.
          const p = clamp01((volley - def.delay) / def.duration);
          const settle = power2InOut((volley - def.delay - def.duration * 0.35) / (def.duration * 0.75));
          // In, from its own edge; out, the same flight backwards, but sideways.
          const out = t >= story.exit ? departure(item) : launch(item);
          const flyX = out.x * (1 - power3Out(p));
          const flyY = out.y * (1 - power2Out(p));
          const spin = lerp(def.spin, def.tilt, power3Out((volley - def.delay) / (def.duration * 1.1)));
          const appear = clamp01((volley - def.delay) / 0.12);
          const crowdScale = lerp(1.06, layer.scale, settle);
          // Behind the text: how far into its half the puppet drifts (0 on the stage half).
          const across = ((item.rest.x / 100) * vw - vw / 2) / (vw * 0.08);
          const behind = textSide ? smooth(textSide === 'left' ? -across : across) : 0;
          const crowdOpacity =
            appear * lerp(1, layer.opacity, settle) * (1 - DRIFT_CROWD_DIM.opacity * dim) * (1 - DRIFT_CROWD_DIM.text * dim * behind) * recede;
          const crowdBlur = lerp(0, layer.blur, settle);

          // The story: blending between the crowd and the stage.
          const where = placeAt(item.track, t);
          const a = anchorAt(item, where.from);
          const b = anchorAt(item, where.to);
          const onStage = lerp(a.stage, b.stage, where.p);
          const crowdX = (item.rest.x / 100) * vw;
          const crowdY = item.top + PILL_CENTRE + item.parallax;
          const x = flyX * (1 - onStage) + lerp(a.x, b.x, where.p) - crowdX;
          const y = flyY * (1 - onStage) + lerp(a.y, b.y, where.p) - crowdY;
          const rotation = spin * (1 - onStage);
          const scale = lerp(crowdScale, stage.scale, onStage);
          const opacity = lerp(crowdOpacity, 1, onStage) * fadeAt(item.track, t);
          const blur = lerp(crowdBlur, 0, onStage);
          put(item.flight, {
            transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rotation.toFixed(2)}deg) scale(${scale.toFixed(3)})`,
            opacity: opacity.toFixed(3),
            filter: blur > 0.05 ? `blur(${blur.toFixed(1)}px)` : 'none',
          });
          put(item.slot, { 'z-index': onStage > 0 ? '10' : '' });
          drawPuppet(item, volley);
        }

        for (const cloud of sky) {
          const shown = clamp01((volley - 0.25) / 1.2);
          put(cloud.element, { opacity: (shown * (0.55 + 0.45 * cloud.def.depth)).toFixed(3) });
        }
        keyEls.forEach((element, index) => {
          const hint = story.keys[index]!;
          put(element, { opacity: hintAt(hint.start, hint.end, t).toFixed(3) });
        });
        propEls.forEach((element, index) => {
          const show = story.props[index]!;
          put(element, { opacity: (smooth((t - show.in[0]) / (show.in[1] - show.in[0])) * (1 - smooth((t - show.out[0]) / (show.out[1] - show.out[0])))).toFixed(3) });
        });

        // Get started has a clear sky: the clouds melt with the volley's way out, as they came.
        put(layerEl, { visibility: volley > 0 && t < story.duration ? 'visible' : 'hidden' });
      };

      measure();

      const context = gsap.context(() => {
        // The title, the benefits and their stories: one pinned, scrubbed line of seconds (no snap).
        const driver = { t: 0 };
        const master = gsap.timeline();
        master.to(driver, { t: story.duration, duration: story.duration, ease: 'none', onUpdate: () => ((state.t = driver.t), render()) }, 0);
        pinEl.dataset.labels = JSON.stringify({ start: 0, ...story.labels, end: story.duration });
        pinEl.dataset.rests = JSON.stringify(story.rests.map(([from, to]) => [Number(from.toFixed(3)), Number(to.toFixed(3))]));
        const pinLength = () => (window.innerHeight * story.duration) / T.secondsPerScreen;
        ScrollTrigger.create({
          trigger: pinEl,
          start: 'top top',
          end: () => `+=${pinLength()}`,
          pin: true,
          scrub: LIFE_SCRUB,
          animation: master,
          invalidateOnRefresh: true,
        });
        // The volley, scrubbed: from right before the title appears to the middle of its plateau.
        const volley = { v: 0 };
        const flight = gsap.timeline({ paused: true });
        flight.to(volley, { v: 1, duration: 1, ease: 'none', onUpdate: () => ((state.volley = volley.v), render()) });
        volleyTrigger = ScrollTrigger.create({
          trigger: pinEl,
          start: `top ${DRIFT_VOLLEY_START}`,
          end: () => `top+=${(pinLength() * story.settled) / story.duration} top`,
          scrub: LIFE_SCRUB,
          animation: flight,
          invalidateOnRefresh: true,
        });
        ScrollTrigger.create({
          start: 0,
          end: 'max',
          onUpdate: (self) => {
            state.scroll = self.scroll();
            parallax();
            render();
          },
        });
        const onRefresh = () => {
          measure();
          state.scroll = window.scrollY;
          parallax();
          render();
        };
        ScrollTrigger.addEventListener('refresh', onRefresh);
        parallax();
        render();
        settleHash();
        return () => ScrollTrigger.removeEventListener('refresh', onRefresh);
      }, pinEl);

      return () => {
        context.revert();
        for (const item of items) {
          gsap.set(item.slot, { clearProps: 'all' });
          item.flight.removeAttribute('style');
        }
        for (const cloud of sky) gsap.set(cloud.element, { clearProps: 'all' });
        for (const plate of plateEls) plate.removeAttribute('style');
        for (const element of [layerEl, ...plateEls, ...items.flatMap((item) => [item.slot, item.flight]), ...sky.map((cloud) => cloud.element), ...keyEls, ...propEls]) {
          written.delete(element);
        }
        layerEl.style.visibility = 'hidden';
      };
    }

    return () => {
      generation += 1;
      off();
      teardown?.();
    };
    // `puppets`, `clouds` and `timeline` derive from `phone`.
  }, [phone, timeline]);

  return (
    <>
      <div ref={layer} className="drift-layer" aria-hidden="true">
        {clouds.map((cloud, index) => (
          <div
            key={index}
            className="drift-cloud"
            data-flip={cloud.flip ? '' : undefined}
            style={
              {
                left: `${cloud.x}vw`,
                '--w': `${cloud.w}vw`,
                '--depth': cloud.depth,
                aspectRatio: String(ASPECT.get(cloud.shape)),
              } as CSSProperties
            }
          >
            <CloudImage shape={cloud.shape} theme="day" w={cloud.w} />
            <CloudImage shape={cloud.shape} theme="night" w={cloud.w} />
          </div>
        ))}
        {timeline?.props.map((show, index) =>
          show.prop === 'field' ? (
            <div key={index} className="drift-prop drift-field">
              <span className="drift-field-text">Search the sky</span>
              <span className="drift-caret" />
            </div>
          ) : (
            <p key={index} className="drift-prop drift-announce">
              {DRIFT_ANNOUNCEMENT}
            </p>
          ),
        )}
        {timeline
          ? puppets.map((puppet) => (
              <div key={puppet.id} className="drift-slot" data-layer={puppet.layer}>
                <div className="drift-flight">
                  <Puppet
                    states={timeline.actors.get(puppet.id)!.states}
                    {...(puppet.dir ? { dir: puppet.dir } : {})}
                  />
                </div>
              </div>
            ))
          : null}
        {timeline?.keys.map((hint, index) => (
          <kbd key={index} className="drift-key">
            {hint.key}
          </kbd>
        ))}
      </div>
      <div ref={pin} className="drift-pin">
        <div ref={plates} className="benefits mx-auto max-w-6xl px-4 sm:px-6">
          <div className="benefit benefit-intro" data-plate="intro">
            <h2 id="drifting-title">{TITLE}</h2>
            <p>{LEAD}</p>
          </div>
          <ol className="benefit-plates">
            {BENEFITS.map((benefit, index) => (
              <li key={benefit.id} className="benefit" data-plate={benefit.id} data-side={BENEFIT_TEXT_SIDES[index]}>
                <span className="benefit-step">{step(index)} / {step(BENEFITS.length - 1)}</span>
                <h3>{benefit.title}</h3>
                <p>{benefit.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </>
  );
}
