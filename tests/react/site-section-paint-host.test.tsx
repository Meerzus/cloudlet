import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { heroRamp } from '../../apps/site/src/lib/picker-ramp';

/** A renderer that only records what it was asked: jsdom has no WebGL. */
const made = vi.hoisted(() => [] as { canvas: HTMLCanvasElement; calls: string[]; destroyed: boolean }[]);
vi.mock('../../apps/site/src/components/picker/paint-renderer', () => ({
  LIFT: 0.97,
  PaintRenderer: {
    create(canvas: HTMLCanvasElement) {
      const record = { canvas, calls: [] as string[], destroyed: false };
      made.push(record);
      const note = (name: string) => () => void record.calls.push(name);
      return {
        setFrame: note('setFrame'),
        setLayout: note('setLayout'),
        setScroll: note('setScroll'),
        setInvert: note('setInvert'),
        paint: note('paint'),
        pointerMove: note('pointerMove'),
        pointerDown: note('pointerDown'),
        pointerLeave: note('pointerLeave'),
        setMoving: note('setMoving'),
        setActive: note('setActive'),
        destroy: () => void (record.destroyed = true),
      };
    },
  },
}));
vi.mock('../../apps/site/src/lib/picker-motion', () => ({ softwareGL: () => false }));

type Watcher = { callback: IntersectionObserverCallback; options: IntersectionObserverInit | undefined; targets: Element[] };
let watchers: Watcher[] = [];

beforeEach(() => {
  made.length = 0;
  watchers = [];
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private readonly watcher: Watcher;
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.watcher = { callback, options, targets: [] };
        watchers.push(this.watcher);
      }
      observe(target: Element) {
        this.watcher.targets.push(target);
      }
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** A section with its paint box, as paint-section.tsx renders it. */
function section(id: string) {
  const element = document.createElement('section');
  element.id = id;
  const box = document.createElement('div');
  box.className = 'paint-section';
  const still = document.createElement('canvas');
  const frame = document.createElement('img');
  box.append(still);
  element.append(box);
  document.body.append(element);
  return { element, box, still, frame };
}

/** Tells the "near the window" observer of a section whether it is near. */
function near(target: Element, isIntersecting: boolean) {
  for (const watcher of watchers) {
    if (watcher.options?.rootMargin === '25% 0px' && watcher.targets.includes(target)) {
      watcher.callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
    }
  }
}

describe('the paint of several sections on one page', () => {
  it('shares one WebGL context: the canvas draws the section near the window and moves with it', async () => {
    const { mountSectionPaint } = await import('../../apps/site/src/components/picker/section-paint');
    const colors = { hex: '#ff6a3d', stops: heroRamp('#ff6a3d')!.stops };
    const hero = section('hero');
    const chapter = section('chapter');
    const first = mountSectionPaint({ box: hero.box, section: hero.element, still: hero.still, frame: hero.frame, calm: 'p', ...colors });
    const second = mountSectionPaint({ box: chapter.box, section: chapter.element, still: chapter.still, frame: chapter.frame, calm: 'p', ...colors });
    expect(made).toHaveLength(1);
    const [renderer] = made;

    near(hero.element, true);
    expect(document.querySelectorAll('canvas.paint-section-gl')).toHaveLength(1);
    expect(renderer!.canvas.parentElement).toBe(hero.box);
    expect(hero.box.dataset.state).toBe('drawn');
    expect(chapter.box.dataset.state).toBe('flat');

    // The page scrolls down: the hero leaves, the chapter comes near and takes the same canvas.
    near(hero.element, false);
    near(chapter.element, true);
    expect(renderer!.canvas.parentElement).toBe(chapter.box);
    expect(chapter.box.dataset.state).toBe('drawn');
    expect(hero.box.dataset.state).toBe('flat');
    expect(made).toHaveLength(1);

    // A section that goes keeps the context for the other; the last one takes it away.
    first.destroy();
    expect(renderer!.destroyed).toBe(false);
    second.destroy();
    expect(renderer!.destroyed).toBe(true);
    expect(document.querySelectorAll('canvas.paint-section-gl')).toHaveLength(0);
  });

  it('a page with one painted section draws it as before', async () => {
    const { mountSectionPaint } = await import('../../apps/site/src/components/picker/section-paint');
    const only = section('chapter');
    const paint = mountSectionPaint({ box: only.box, section: only.element, still: only.still, frame: only.frame, calm: 'p', hex: '#2e8b57', stops: heroRamp('#2e8b57')!.stops });
    near(only.element, true);
    expect(made).toHaveLength(1);
    expect(made[0]!.canvas.parentElement).toBe(only.box);
    expect(only.box.dataset.paint).toBe('fixed');
    expect(made[0]!.calls).toContain('setLayout');
    paint.destroy();
    expect(made[0]!.destroyed).toBe(true);
  });
});
