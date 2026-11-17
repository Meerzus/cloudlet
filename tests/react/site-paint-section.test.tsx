import { act, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KitColor } from '../../apps/site/src/components/kit/kit-color';
import { PickerChapter } from '../../apps/site/src/components/kit/picker-chapter';
import { PaintSection } from '../../apps/site/src/components/picker/paint-section';
import { PickerColorProvider, usePickerColor } from '../../apps/site/src/components/picker/picker-color';
import { heroRamp } from '../../apps/site/src/lib/picker-ramp';
import { START_GLOBAL } from '../../apps/site/src/lib/picker-start';

const mount = vi.hoisted(() => vi.fn());
// The scene links push through the router: none is mounted here.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));
vi.mock('../../apps/site/src/components/picker/section-paint', () => ({ mountSectionPaint: mount }));

const root = document.documentElement;
const global = window as unknown as Record<string, unknown>;
let observers: { callback: IntersectionObserverCallback; options: IntersectionObserverInit | undefined }[] = [];

beforeEach(() => {
  observers = [];
  mount.mockReset();
  mount.mockImplementation(() => ({ show: vi.fn(), destroy: vi.fn() }));
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        observers.push({ callback, options });
      }
      observe() {}
      disconnect() {}
    },
  );
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete global[START_GLOBAL];
  root.style.removeProperty('--cp-color');
});

/** Tells the section's approach observer that the section is within a screen of the window. */
const approach = async () => {
  await act(async () => {
    for (const { callback } of observers) callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    // The dynamic import resolves on a later task.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

function Picks() {
  const { pick, hex } = usePickerColor();
  return (
    <button type="button" data-hex={hex} onClick={(event) => pick('#2e8b57', event.currentTarget)}>
      pick
    </button>
  );
}

describe('the color of a chapter on another page', () => {
  it('never writes the address or <html>, and takes no start script', () => {
    vi.useFakeTimers();
    global[START_GLOBAL] = '#1b1f4a';
    // The chapter's own random pick lands on the first curated color, never on the script's by chance.
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const { container } = render(
      <PickerColorProvider page={false}>
        <Picks />
      </PickerColorProvider>,
    );
    const button = container.querySelector('button')!;
    // The start script belongs to the color picker landing: a chapter elsewhere picks its own.
    expect(button.dataset.hex).not.toBe('#1b1f4a');
    expect(global[START_GLOBAL]).toBe('#1b1f4a');
    random.mockRestore();
    act(() => button.click());
    act(() => vi.advanceTimersByTime(1000));
    expect(button.dataset.hex).toBe('#2e8b57');
    expect(window.location.search).toBe('');
    expect(root.style.getPropertyValue('--cp-color')).toBe('');
  });

  it('starts from ?c= when the link has one, so an audit can set it', () => {
    window.history.replaceState(null, '', '/?c=f2b84b,1b1f4a');
    const { container } = render(
      <PickerColorProvider page={false}>
        <Picks />
      </PickerColorProvider>,
    );
    expect(container.querySelector('button')!.dataset.hex).toBe('#f2b84b');
    expect(window.location.search).toBe('?c=f2b84b,1b1f4a');
  });

  it('the color picker landing keeps writing ?c=', () => {
    vi.useFakeTimers();
    window.history.replaceState(null, '', '/color-picker');
    // The landing's random start never lands on the picked color by chance (then nothing would change).
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { container } = render(
      <PickerColorProvider>
        <Picks />
      </PickerColorProvider>,
    );
    act(() => container.querySelector('button')!.click());
    act(() => vi.advanceTimersByTime(1000));
    expect(window.location.search).toBe('?c=2e8b57');
    expect(root.style.getPropertyValue('--cp-color')).toBe('#2e8b57');
  });
});

describe('the paint in a chapter loads as the chapter comes near', () => {
  it('renders on the server as a flat color with no frame, inside the chapter with its two links', () => {
    const html = renderToString(
      <KitColor>
        <PickerChapter />
      </KitColor>,
    );
    expect(html).toContain('id="color-picker"');
    expect(html).toContain('class="paint-section"');
    expect(html).toContain('--paint-color:#ff6a3d');
    expect(html).not.toContain('material-page');
    expect(html).toContain('href="/color-picker?c=ff6a3d"');
    expect(html).toContain('href="/color-picker?c=ff6a3d#palette"');
    expect(html).toContain('Open Color picker');
    expect(html).toContain('Open Color palette');
  });

  it('mounts the renderer and fetches the frame only once the chapter is about a screen away', async () => {
    window.history.replaceState(null, '', '/?c=ff6a3d');
    const { container } = render(
      <PickerColorProvider page={false}>
        <section id="chapter">
          <PaintSection calm="#chapter p" />
          <p>copy</p>
        </section>
      </PickerColorProvider>,
    );
    expect(container.querySelector('picture')).toBeNull();
    expect(mount).not.toHaveBeenCalled();
    expect(observers.some(({ options }) => options?.rootMargin === '100% 0px')).toBe(true);
    await approach();
    expect(container.querySelector('picture source')?.getAttribute('srcset')).toContain('material-page-640.avif');
    expect(mount).toHaveBeenCalledTimes(1);
    const options = mount.mock.calls[0]![0];
    expect(options.section).toBe(container.querySelector('#chapter'));
    expect(options.box).toBe(container.querySelector('.paint-section'));
    expect(options.calm).toBe('#chapter p');
    expect(options.hex).toBe('#ff6a3d');
    expect(options.stops).toEqual(heroRamp('#ff6a3d')!.stops);
  });

  it('a jump spreads from the control that made it, in page coordinates', async () => {
    window.history.replaceState(null, '', '/?c=ff6a3d');
    const { container } = render(
      <PickerColorProvider page={false}>
        <section>
          <PaintSection calm="p" />
          <Picks />
        </section>
      </PickerColorProvider>,
    );
    await approach();
    const paint = mount.mock.results[0]!.value as { show: ReturnType<typeof vi.fn> };
    const button = container.querySelector('button')!;
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ left: 800, top: 200, width: 100, height: 40, right: 900, bottom: 240, x: 800, y: 200, toJSON() {} } as DOMRect);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(500);
    act(() => button.click());
    expect(paint.show).toHaveBeenLastCalledWith('#2e8b57', heroRamp('#2e8b57')!.stops, { x: 800, y: 700, width: 100, height: 40, radius: 0 });
    expect(container.querySelector<HTMLElement>('.paint-section')!.style.getPropertyValue('--paint-color')).toBe('#2e8b57');
  });
});
