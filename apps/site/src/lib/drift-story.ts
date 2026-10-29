import { poseOf, transitionDuration, type PuppetMetrics, type PuppetState } from './puppet-model';
import {
  BENEFITS,
  BENEFIT_TEXT_SIDES,
  DRIFT_VOLLEY_START,
  restState,
  sideOf,
  type DriftKey,
  type DriftProp,
  type DriftPuppet,
  type DriftSide,
  type Story,
  type StoryBeat,
} from './drift-scene';

/**
 * Scene 3's timeline (LANDING §8): lays the title, the six benefits and their stories out on one
 * line of seconds. Pure — the scene scrubs it with the pin, tests read it. One motion at a time:
 * every beat ends before the next starts and is followed by a rest where nothing moves, so a
 * scroll that stops anywhere mostly rests on a clean frame (the scene has no snap).
 */

export const STORY_TIMING = {
  /**
   * The title plateau: it enters, then holds; the volley settles `settle` seconds into the hold,
   * so it flies in over about 1.4 screens of scroll (owner, 28.10.2026: was 1.1, too fast).
   */
  intro: { enter: 0.8, hold: 5, settle: 3.5 },
  textIn: 1.2,
  textOut: 1.2,
  /** From the text in place to the first beat, and from the last beat to the text leaving. */
  lead: 0.35,
  tail: 0.35,
  /** The next benefit enters almost as the previous one starts to leave: the text moves across and changes at once. */
  overlap: 1.1,
  /** An actor leaves the crowd for the stage, or flies onto another actor's stack. */
  come: 2,
  /** Actors return to the crowd. */
  go: 1.8,
  /** A prop fades in or out. */
  prop: 0.6,
  /** Rest after a beat, unless the beat says otherwise. */
  hold: 0.7,
  /** Puppet transitions get this much more timeline than their real length: ≈ ¼ screen of scroll each (owner, L07 review). */
  stretch: 3.6,
  /** A merged actor fades into the stack it lands on, a split one out of it. */
  fade: 0.2,
  /** The crowd steps back this long before a story and forward after it. */
  dim: 0.45,
  /** Timeline seconds per screen of scroll: the pin is about 22.5 screens long on desktop, 16.7 on phones (LANDING §8). */
  secondsPerScreen: 7,
} as const;

/**
 * Timeline seconds of the volley's scroll before the pin starts: it begins with the pin's top at
 * DRIFT_VOLLEY_START of the viewport, so it scrolls the rest of the screen before `t = 0`.
 */
export const VOLLEY_LEAD = (1 - Number.parseFloat(DRIFT_VOLLEY_START) / 100) * STORY_TIMING.secondsPerScreen;

/** Where an actor is: in the crowd, on a benefit's stage beside the text (on one half), or below the screen. */
export type Anchor =
  | { readonly kind: 'crowd' }
  | { readonly kind: 'stage'; readonly side: DriftSide; readonly benefit: number }
  | { readonly kind: 'below' };

export interface Move {
  readonly start: number;
  /** Timeline seconds; the puppet's own time is `(t - start) / stretch`. */
  readonly length: number;
  readonly stretch: number;
  readonly from: number;
  readonly to: number;
  readonly via?: { readonly state: number; readonly at: number };
}

export interface Place {
  readonly start: number;
  readonly end: number;
  readonly from: Anchor;
  readonly to: Anchor;
}

export interface Fade {
  readonly start: number;
  readonly end: number;
  readonly from: number;
  readonly to: number;
}

export interface ActorTrack {
  readonly id: string;
  /** Every state its puppet shows: its own look, then its story's states. */
  readonly states: readonly PuppetState[];
  readonly rest: number;
  readonly side: DriftSide;
  readonly moves: readonly Move[];
  readonly places: readonly Place[];
  /** Visibility multiplier (a merged actor is gone until it splits out or comes back). */
  readonly fades: readonly Fade[];
}

export interface BenefitWindow {
  readonly id: string;
  /** Half the text sits on; the actors play on the other one. */
  readonly textSide: DriftSide;
  readonly stageSide: DriftSide;
  readonly textIn: readonly [number, number];
  readonly textOut: readonly [number, number];
  /** First beat to last beat. */
  readonly stage: readonly [number, number];
}

export interface KeyHint {
  readonly key: DriftKey;
  readonly side: DriftSide;
  readonly benefit: number;
  readonly start: number;
  readonly end: number;
}

export interface PropShow {
  readonly prop: DriftProp;
  readonly side: DriftSide;
  readonly benefit: number;
  /** Fade-in window and fade-out window. */
  readonly in: readonly [number, number];
  readonly out: readonly [number, number];
}

export interface DriftTimeline {
  readonly duration: number;
  readonly intro: { readonly textIn: readonly [number, number]; readonly textOut: readonly [number, number] };
  /** In the title's plateau: the volley has settled by then. */
  readonly settled: number;
  readonly benefits: readonly BenefitWindow[];
  readonly actors: ReadonlyMap<string, ActorTrack>;
  readonly keys: readonly KeyHint[];
  readonly props: readonly PropShow[];
  /** Windows where nothing moves (recordings check that stops land in them). */
  readonly rests: readonly (readonly [number, number])[];
  /** Plateau centres by name: the title and each benefit's stage. */
  readonly labels: Readonly<Record<string, number>>;
  /** The final exit starts here: the volley plays backwards, over as much scroll as it flew in. */
  readonly exit: number;
  /** Timeline seconds of that exit. */
  readonly exitLength: number;
}

/** Transition lengths depend on modes, faces, counts and timings only — not on measured sizes. */
const NO_METRICS: PuppetMetrics = { width: 0, pillHeight: 44, islandRadius: 24, indicatorHeight: 0, layers: new Map() };
const length = (states: readonly PuppetState[], from: number, to: number) =>
  transitionDuration(poseOf(states[from]!, NO_METRICS, 1), poseOf(states[to]!, NO_METRICS));

/** The actors of a story, in order of appearance. */
export function storyCast(story: Story): string[] {
  const cast: string[] = [];
  const add = (id: string) => !cast.includes(id) && cast.push(id);
  for (const beat of story.beats) {
    if (beat.kind === 'go') beat.actors.forEach(add);
    else if (beat.kind !== 'prop') add(beat.actor);
    if (beat.kind === 'merge') add(beat.into);
    if (beat.kind === 'split') add(beat.from);
  }
  return cast;
}

export function buildDriftTimeline(crowd: readonly DriftPuppet[], stories: readonly Story[], phone = false): DriftTimeline {
  const T = STORY_TIMING;
  type Track = { id: string; states: PuppetState[]; rest: number; side: DriftSide; moves: Move[]; places: Place[]; fades: Fade[]; state: number; at: Anchor; gone: boolean };
  const tracks = new Map<string, Track>();
  for (const puppet of crowd) {
    const rest = restState(puppet);
    tracks.set(puppet.id, {
      id: puppet.id,
      states: [...puppet.states],
      rest,
      side: sideOf(puppet, phone),
      moves: [],
      places: [],
      fades: [],
      state: rest,
      at: { kind: 'crowd' },
      gone: false,
    });
  }
  const track = (id: string) => {
    const found = tracks.get(id);
    if (!found) throw new Error(`Story actor ${id} is not in the crowd`);
    return found;
  };
  const indexOf = (actor: Track, state: PuppetState) => {
    const found = actor.states.indexOf(state);
    if (found >= 0) return found;
    actor.states.push(state);
    return actor.states.length - 1;
  };
  /** Moves the puppet to `state` from `start` (within `fit` seconds of timeline if given); returns the move's end. */
  const move = (actor: Track, state: number, start: number, via?: { state: number; at: number }, fit = Infinity) => {
    const seconds = (via ? via.at : 0) + length(actor.states, actor.state, state);
    const stretch = Math.min(T.stretch, fit / seconds);
    const item: Move = { start, length: seconds * stretch, stretch, from: actor.state, to: state, ...(via ? { via } : {}) };
    actor.moves.push(item);
    actor.state = state;
    return start + item.length;
  };
  const place = (actor: Track, start: number, end: number, to: Anchor) => {
    actor.places.push({ start, end, from: actor.at, to });
    actor.at = to;
  };

  const keys: KeyHint[] = [];
  const props: PropShow[] = [];
  const rests: [number, number][] = [];
  const labels: Record<string, number> = {};
  const benefits: BenefitWindow[] = [];
  const open = new Map<DriftProp, { side: DriftSide; start: number }>();

  const introIn: [number, number] = [0, T.intro.enter];
  const introOut: [number, number] = [T.intro.enter + T.intro.hold, T.intro.enter + T.intro.hold + T.textOut];
  const settled = T.intro.enter + T.intro.settle;
  const exitLength = VOLLEY_LEAD + settled;
  labels.intro = settled;
  rests.push([settled, introOut[0]]);
  let cursor = introOut[1] - T.overlap;
  let exit = 0;
  let end = 0;

  const byBenefit = new Map(stories.map((story) => [story.benefit, story]));
  BENEFITS.forEach((benefit, index) => {
    const story = byBenefit.get(benefit.id);
    const textIn: [number, number] = [cursor, cursor + T.textIn];
    let time = textIn[1] + T.lead;
    rests.push([textIn[1], time]);
    const stageStart = time;
    const textSide = BENEFIT_TEXT_SIDES[index] ?? 'left';
    const side: DriftSide = textSide === 'left' ? 'right' : 'left';

    for (const beat of story?.beats ?? []) {
      const start = time;
      time = playBeat(beat, start);
      const hold = beat.hold ?? (beat.kind === 'prop' ? 0.3 : T.hold);
      if (hold > 0) rests.push([time, time + hold]);
      time += hold;
    }

    function playBeat(beat: StoryBeat, start: number): number {
      switch (beat.kind) {
        case 'come': {
          const actor = track(beat.actor);
          place(actor, start, start + T.come, { kind: 'stage', side, benefit: index });
          return start + T.come;
        }
        case 'state': {
          const actor = track(beat.actor);
          const via = beat.via ? { state: indexOf(actor, beat.via), at: beat.at ?? 0 } : undefined;
          const done = move(actor, indexOf(actor, beat.state), start, via);
          if (beat.key) keys.push({ key: beat.key, side, benefit: index, start: start - 0.25, end: Math.max(done, start + 0.9) });
          return done;
        }
        case 'merge': {
          // The actor flies onto `into`'s place; on landing it fades into the stack, which takes its face.
          const actor = track(beat.actor);
          const into = track(beat.into);
          const land = start + T.come;
          place(actor, start, land, { kind: 'stage', side, benefit: index });
          actor.fades.push({ start: land - T.fade, end: land, from: 1, to: 0 });
          actor.gone = true;
          const via = beat.via ? { state: indexOf(into, beat.via), at: beat.at ?? 0 } : undefined;
          // An interrupted transition was already under way when the newcomer landed.
          const begin = via ? land - via.at * T.stretch : land;
          return Math.max(land, move(into, indexOf(into, beat.state), begin, via));
        }
        case 'split': {
          // The actor leaves `from`'s stack again and heads straight back to the crowd.
          const actor = track(beat.actor);
          const from = track(beat.from);
          actor.at = { kind: 'stage', side, benefit: index };
          actor.fades.push({ start, end: start + T.fade, from: 0, to: 1 });
          actor.gone = false;
          const done = move(from, indexOf(from, beat.state), start);
          place(actor, start, start + T.go, { kind: 'crowd' });
          return Math.max(done, start + T.go);
        }
        case 'go': {
          let done = start;
          for (const id of beat.actors) {
            const actor = track(id);
            if (actor.at.kind === 'crowd') continue;
            if (actor.gone) {
              // Closed in the story: it comes back from below the screen, like the parallax wrap.
              actor.at = { kind: 'below' };
              actor.fades.push({ start, end: start + T.fade, from: 0, to: 1 });
              actor.gone = false;
            }
            place(actor, start, start + T.go, { kind: 'crowd' });
            // Its own look comes back on the way, within the return.
            if (actor.state !== actor.rest) move(actor, actor.rest, start, undefined, T.go);
            done = Math.max(done, start + T.go);
          }
          return done;
        }
        case 'prop': {
          if (beat.show) open.set(beat.prop, { side, start });
          else {
            const shown = open.get(beat.prop);
            if (shown) props.push({ prop: beat.prop, side: shown.side, benefit: index, in: [shown.start, shown.start + T.prop], out: [start, start + T.prop] });
            open.delete(beat.prop);
          }
          return start + T.prop;
        }
      }
    }

    const stageEnd = time;
    labels[benefit.id] = (stageStart + stageEnd) / 2;
    const textOut: [number, number] = [stageEnd + T.tail, stageEnd + T.tail + T.textOut];
    rests.push([stageEnd, textOut[0]]);
    benefits.push({ id: benefit.id, textSide, stageSide: side, textIn, textOut, stage: [stageStart, stageEnd] });
    if (index === BENEFITS.length - 1) {
      exit = textOut[0];
      end = Math.max(textOut[1], exit + exitLength);
    }
    cursor = textOut[1] - T.overlap;
  });

  const actors = new Map<string, ActorTrack>();
  for (const { id, states, rest, side, moves, places, fades } of tracks.values()) actors.set(id, { id, states, rest, side, moves, places, fades });
  return {
    duration: end,
    intro: { textIn: introIn, textOut: introOut },
    settled,
    benefits,
    actors,
    keys,
    props,
    rests: rests.filter(([from, to]) => to - from >= 0.2),
    labels,
    exit,
    exitLength,
  };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** Smoothstep: the scene's ease for places and fades. */
export const smooth = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const easeInOut = (value: number) => {
  const t = clamp01(value);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};

/** Where an actor is at `t`: the anchors it travels between and how far (0..1). */
export function placeAt(actor: ActorTrack, t: number): { from: Anchor; to: Anchor; p: number } {
  let current: { from: Anchor; to: Anchor; p: number } = { from: { kind: 'crowd' }, to: { kind: 'crowd' }, p: 1 };
  for (const item of actor.places) {
    if (t < item.start) break;
    current = { from: item.from, to: item.to, p: easeInOut((t - item.start) / (item.end - item.start)) };
  }
  return current;
}

/** Visibility of an actor at `t` (1 unless merged away). */
export function fadeAt(actor: ActorTrack, t: number) {
  let value = 1;
  for (const item of actor.fades) {
    if (t < item.start) break;
    value = item.from + (item.to - item.from) * clamp01((t - item.start) / (item.end - item.start));
  }
  return value;
}

/** What the actor's puppet shows at `t`: a move in progress (puppet seconds) or a state at rest. */
export function puppetAt(actor: ActorTrack, t: number): { move: Move; time: number } | { state: number } {
  let state = actor.rest;
  for (const item of actor.moves) {
    if (t < item.start) break;
    if (t < item.start + item.length) return { move: item, time: (t - item.start) / item.stretch };
    state = item.to;
  }
  return { state };
}

/** How far the crowd has stepped back at `t` (0..1): during each benefit's stage. */
export function dimAt(timeline: DriftTimeline, t: number) {
  const T = STORY_TIMING;
  let value = 0;
  for (const { stage } of timeline.benefits) {
    const up = smooth((t - (stage[0] - T.dim)) / T.dim);
    const down = smooth((t - stage[1]) / T.dim);
    value = Math.max(value, up * (1 - down));
  }
  return value;
}

/** The benefit on screen at `t` (the latest one that has started entering), if any. */
export function benefitAt(timeline: DriftTimeline, t: number) {
  let current: BenefitWindow | undefined;
  for (const benefit of timeline.benefits) if (t >= benefit.textIn[0] && t < benefit.textOut[1]) current = benefit;
  return current;
}

/**
 * How much of the volley is still in at `t` (1..0): the final exit plays the volley backwards
 * (owner, 28.10.2026), linearly in scroll as the volley itself, so every puppet flies back out to
 * its own edge along its own path and at the speed it came in.
 */
export function volleyLeftAt(timeline: DriftTimeline, t: number) {
  return 1 - clamp01((t - timeline.exit) / timeline.exitLength);
}

/** Opacity of a key hint or prop at `t`. */
export function hintAt(start: number, end: number, t: number, fade = 0.2) {
  return smooth((t - start) / fade) * (1 - smooth((t - end) / fade));
}
