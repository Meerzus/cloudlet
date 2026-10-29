import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BENEFITS,
  DRIFT_CLOUDS,
  DRIFT_LAYERS,
  DRIFT_PHONE_LAYERS,
  DRIFT_PHONE_STORIES,
  DRIFT_PUPPETS,
  DRIFT_STORIES,
  sideOf,
  type Story,
} from '../../apps/site/src/lib/drift-scene';
import { STORY_TIMING, VOLLEY_LEAD, buildDriftTimeline, dimAt, placeAt, puppetAt, storyCast, volleyLeftAt } from '../../apps/site/src/lib/drift-story';
import { FAQ } from '../../apps/site/src/lib/faq';
import { formatKB, PACKAGE_SIZE } from '../../apps/site/src/lib/site';

const manifest = JSON.parse(readFileSync(new URL('../../packages/toast/package.json', import.meta.url), 'utf8')) as { version: string };

const PHONE = DRIFT_PUPPETS.filter((puppet) => puppet.phone);
const byId = new Map(DRIFT_PUPPETS.map((puppet) => [puppet.id, puppet]));

describe('site scene 3: the crowd', () => {
  it('flies 12 puppets on desktop and 6 of them on phones', () => {
    expect(DRIFT_PUPPETS).toHaveLength(12);
    expect(PHONE).toHaveLength(6);
    expect(DRIFT_PHONE_LAYERS.length).toBeLessThan(DRIFT_LAYERS.length);
    expect(new Set(DRIFT_PUPPETS.map((puppet) => puppet.id)).size).toBe(DRIFT_PUPPETS.length);
  });

  it('mixes kinds, pills and Islands, morphs in flight and RTL, all in the page theme', () => {
    const kinds = new Set(DRIFT_PUPPETS.flatMap((puppet) => puppet.states.map((state) => state.face.kind)));
    expect([...kinds].sort()).toEqual(['error', 'info', 'loading', 'success', 'warning']);
    const morphs = DRIFT_PUPPETS.filter((puppet) => puppet.states.length === 2);
    expect(morphs.length).toBeGreaterThanOrEqual(3);
    for (const puppet of morphs) expect(puppet.states.map((state) => state.mode)).toEqual(['pill', 'island']);
    for (const puppet of DRIFT_PUPPETS) expect('theme' in puppet, puppet.id).toBe(false);
    expect(DRIFT_PUPPETS.filter((puppet) => puppet.dir === 'rtl').length).toBeGreaterThanOrEqual(1);
  });

  it('paints far to near and keeps nearer layers off the centre column', () => {
    const layers = DRIFT_PUPPETS.map((puppet) => puppet.layer);
    expect(layers).toEqual([...layers].sort((a, b) => a - b));
    for (const puppet of DRIFT_PUPPETS.filter((item) => item.layer > 0)) {
      expect(puppet.x < 25 || puppet.x > 75, puppet.id).toBe(true);
    }
  });

  it('settles deeper layers smaller, paler and hazier, like the sky (0.6 / 0.85 / 1.05)', () => {
    expect(DRIFT_LAYERS.map((layer) => layer.scale)).toEqual([0.6, 0.85, 1.05]);
    for (const layers of [DRIFT_LAYERS, DRIFT_PHONE_LAYERS]) {
      for (let index = 1; index < layers.length; index += 1) {
        const far = layers[index - 1]!;
        const near = layers[index]!;
        expect(far.depth).toBeLessThan(near.depth);
        expect(far.scale).toBeLessThan(near.scale);
        expect(far.opacity).toBeLessThan(near.opacity);
        expect(far.blur).toBeGreaterThanOrEqual(near.blur);
      }
    }
    expect(DRIFT_PHONE_LAYERS.every((layer) => layer.blur === 0)).toBe(true);
    for (const cloud of DRIFT_CLOUDS) expect(cloud.depth).toBeGreaterThan(0);
  });
});

describe('site scene 3: casting', () => {
  const casts = (stories: readonly Story[]) => stories.map(storyCast);

  it('tells one story per benefit, in order', () => {
    for (const stories of [DRIFT_STORIES, DRIFT_PHONE_STORIES]) expect(stories.map((story) => story.benefit)).toEqual(BENEFITS.map((benefit) => benefit.id));
  });

  it('casts 2 / 3 / 2 / 2 / 2 / 1 on desktop and every crowd puppet exactly once', () => {
    expect(casts(DRIFT_STORIES).map((cast) => cast.length)).toEqual([2, 3, 2, 2, 2, 1]);
    expect(casts(DRIFT_STORIES).flat().sort()).toEqual(DRIFT_PUPPETS.map((puppet) => puppet.id).sort());
  });

  it('casts one actor per benefit on phones, each of the phone crowd once', () => {
    expect(casts(DRIFT_PHONE_STORIES).map((cast) => cast.length)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(casts(DRIFT_PHONE_STORIES).flat().sort()).toEqual(PHONE.map((puppet) => puppet.id).sort());
  });

  it('merges actors only onto a stack of their own side', () => {
    for (const story of DRIFT_STORIES) {
      for (const beat of story.beats) {
        if (beat.kind !== 'merge' && beat.kind !== 'split') continue;
        const actor = byId.get(beat.actor)!;
        const host = byId.get(beat.kind === 'merge' ? beat.into : beat.from)!;
        expect(sideOf(actor), `${actor.id} → ${host.id}`).toBe(sideOf(host));
      }
    }
  });

  it('starts each story from the actor’s own face', () => {
    const timeline = buildDriftTimeline(DRIFT_PUPPETS, DRIFT_STORIES);
    for (const puppet of DRIFT_PUPPETS) {
      const track = timeline.actors.get(puppet.id)!;
      const first = track.moves[0];
      if (first) expect(first.from, puppet.id).toBe(track.rest);
    }
  });
});

describe('site scene 3: the timeline', () => {
  for (const [name, crowd, stories, phone] of [
    ['desktop', DRIFT_PUPPETS, DRIFT_STORIES, false],
    ['phone', PHONE, DRIFT_PHONE_STORIES, true],
  ] as const) {
    const timeline = buildDriftTimeline(crowd, stories, phone);

    it(`${name}: lasts about 21 screens of scroll (fewer on phones) and lays the benefits out in order`, () => {
      const screens = timeline.duration / STORY_TIMING.secondsPerScreen;
      expect(screens).toBeGreaterThan(phone ? 12 : 18);
      expect(screens).toBeLessThan(phone ? 18 : 24);
      let last = timeline.intro.textOut[0];
      for (const benefit of timeline.benefits) {
        expect(benefit.textIn[0]).toBeGreaterThan(last - STORY_TIMING.overlap - 1e-9);
        expect(benefit.stage[0]).toBeGreaterThanOrEqual(benefit.textIn[1]);
        expect(benefit.textOut[0]).toBeGreaterThanOrEqual(benefit.stage[1]);
        last = benefit.textOut[0];
      }
      expect(timeline.settled).toBeLessThan(timeline.benefits[0]!.textIn[0]);
    });

    it(`${name}: moves one actor at a time, with rests between beats`, () => {
      // Story motions (places of actors that leave the crowd, and puppet moves) never overlap,
      // except an interruption (a merge with `via`) and actors returning together.
      const spans = [...timeline.actors.values()].flatMap((track) => [
        ...track.moves.map((move) => ({ id: track.id, start: move.start, end: move.start + move.length, via: Boolean(move.via) })),
      ]);
      spans.sort((a, b) => a.start - b.start);
      for (let index = 1; index < spans.length; index += 1) {
        const previous = spans[index - 1]!;
        const current = spans[index]!;
        if (current.via || previous.via) continue;
        if (current.id !== previous.id) expect(current.start, `${previous.id} / ${current.id}`).toBeGreaterThanOrEqual(previous.end - 1e-6);
      }
      expect(timeline.rests.length).toBeGreaterThan(30);
      for (const [from, to] of timeline.rests) {
        expect(to).toBeGreaterThan(from);
        for (const span of spans) expect(span.end <= from + 1e-6 || span.start >= to - 1e-6, `${span.id} in rest ${from}`).toBe(true);
      }
    });

    it(`${name}: every actor is back in the crowd, in its own look, before the exit`, () => {
      for (const track of timeline.actors.values()) {
        expect(placeAt(track, timeline.exit).to.kind, track.id).toBe('crowd');
        expect(puppetAt(track, timeline.exit), track.id).toEqual({ state: track.rest });
      }
    });

    it(`${name}: dims the crowd only while a story plays`, () => {
      expect(dimAt(timeline, timeline.settled)).toBe(0);
      const [first] = timeline.benefits;
      expect(dimAt(timeline, (first!.stage[0] + first!.stage[1]) / 2)).toBe(1);
    });

    it(`${name}: sends the crowd off by playing the volley backwards over the same scroll (owner, 28.10.2026)`, () => {
      // The volley flies in from the pin's top at 20% of the viewport to `settled`: 0.8 screen + settled.
      expect(VOLLEY_LEAD).toBeCloseTo(0.8 * STORY_TIMING.secondsPerScreen);
      expect(timeline.exitLength).toBeCloseTo(VOLLEY_LEAD + timeline.settled);
      expect(timeline.exitLength / STORY_TIMING.secondsPerScreen).toBeGreaterThan(1.3);
      expect(volleyLeftAt(timeline, timeline.exit)).toBe(1);
      expect(volleyLeftAt(timeline, timeline.exit + timeline.exitLength / 2)).toBeCloseTo(0.5);
      expect(volleyLeftAt(timeline, timeline.duration)).toBe(0);
      expect(timeline.duration).toBeCloseTo(timeline.exit + timeline.exitLength);
    });
  }

  it('alternates the text between halves and casts each benefit from its stage’s half', () => {
    const timeline = buildDriftTimeline(DRIFT_PUPPETS, DRIFT_STORIES);
    expect(timeline.benefits.map((benefit) => benefit.textSide)).toEqual(['left', 'right', 'left', 'right', 'left', 'right']);
    timeline.benefits.forEach((benefit, index) => {
      expect(benefit.stageSide).not.toBe(benefit.textSide);
      for (const id of storyCast(DRIFT_STORIES[index]!)) expect(sideOf(byId.get(id)!), `${benefit.id}: ${id}`).toBe(benefit.stageSide);
    });
  });

  it('moves the text across and changes it almost at once', () => {
    const timeline = buildDriftTimeline(DRIFT_PUPPETS, DRIFT_STORIES);
    for (let index = 1; index < timeline.benefits.length; index += 1) {
      const leaving = timeline.benefits[index - 1]!.textOut;
      const coming = timeline.benefits[index]!.textIn;
      expect(coming[0] - leaving[0]).toBeGreaterThanOrEqual(0);
      expect(coming[0] - leaving[0]).toBeLessThan(0.3);
    }
  });
});

describe('site scene 3: benefits and FAQ', () => {
  it('lists the six benefits in order', () => {
    expect(BENEFITS.map((benefit) => benefit.title)).toEqual([
      'Springs, not keyframes',
      'Stack → Island',
      'Promises built in',
      'Speaks up when it matters',
      'Accessible by default',
      'Fits your stack',
    ]);
  });

  it('answers 5–7 questions and names Sonner only once', () => {
    expect(FAQ.length).toBeGreaterThanOrEqual(5);
    expect(FAQ.length).toBeLessThanOrEqual(7);
    const mentions = FAQ.filter((item) => /sonner/i.test(`${item.question} ${item.answer}`));
    expect(mentions.map((item) => item.id)).toEqual(['sonner']);
  });

  it('prints the package size from PACKAGE_SIZE, and PACKAGE_SIZE matches the latest size report', () => {
    const size = FAQ.find((item) => item.id === 'size')?.answer ?? '';
    // The first-load figure is always named as JavaScript on first load, never as the whole package.
    expect(size).toContain(`${formatKB(PACKAGE_SIZE.start)} of JavaScript on first load, min+gzip`);
    expect(size).toContain(formatKB(PACKAGE_SIZE.lazy));
    expect(size).toContain(formatKB(PACKAGE_SIZE.css));
    expect(size).not.toMatch(/motion/i);
    expect(BENEFITS.find((benefit) => benefit.id === 'stack')?.text).toContain(`${formatKB(PACKAGE_SIZE.start)} of JavaScript on first load.`);
    expect(PACKAGE_SIZE.start + PACKAGE_SIZE.lazy).toBe(PACKAGE_SIZE.javascript);
    expect(PACKAGE_SIZE.version).toBe(manifest.version);

    // The report is a local artifact (gitignored); CI without it still checks the texts above.
    const report = new URL('../../artifacts/size/report.json', import.meta.url);
    if (!existsSync(report)) return;
    const measured = JSON.parse(readFileSync(report, 'utf8')) as {
      package: { version: string };
      ownJavaScript: { jsGzipBytes: number; startJsGzipBytes: number; lazyJsGzipBytes: number };
      packedCss: { gzipBytes: number };
      deltas: { fullConsumerGzipBytes: number };
    };
    if (measured.package.version !== PACKAGE_SIZE.version) return;
    expect({
      start: measured.ownJavaScript.startJsGzipBytes,
      lazy: measured.ownJavaScript.lazyJsGzipBytes,
      javascript: measured.ownJavaScript.jsGzipBytes,
      css: measured.packedCss.gzipBytes,
      total: measured.deltas.fullConsumerGzipBytes,
    }).toEqual({
      start: PACKAGE_SIZE.start,
      lazy: PACKAGE_SIZE.lazy,
      javascript: PACKAGE_SIZE.javascript,
      css: PACKAGE_SIZE.css,
      total: PACKAGE_SIZE.total,
    });
  });
});
