import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bleedOrigin, PaintPage } from '../../apps/site/src/components/picker/paint-page';
import { PaintRenderer } from '../../apps/site/src/components/picker/paint-renderer';
import { Palette } from '../../apps/site/src/components/picker/palette';
import { PickerColorProvider } from '../../apps/site/src/components/picker/picker-color';
import { PickerHero } from '../../apps/site/src/components/picker/picker-hero';
import { lineRects } from '../../apps/site/src/lib/paint-calm';
import { heroRamp, paletteRamp, rampLut } from '../../apps/site/src/lib/picker-ramp';
import { START_GLOBAL } from '../../apps/site/src/lib/picker-start';

const root = document.documentElement;
const global = window as unknown as Record<string, unknown>;

/** A stand-in for the WebGL renderer: records what the page asks of it. */
function fakeRenderer() {
  return {
    paint: vi.fn(),
    setInvert: vi.fn(),
    setMoving: vi.fn(),
    setActive: vi.fn(),
    setScroll: vi.fn(),
    setLayout: vi.fn(),
    setFrame: vi.fn(),
    destroy: vi.fn(),
  };
}

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  window.history.replaceState(null, '', '/color-picker');
  // jsdom lays nothing out and has no line boxes: none, unless a test gives some.
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete global[START_GLOBAL];
  root.classList.remove('dark');
  root.style.removeProperty('--cp-color');
});

describe('the paper map reads lines of text (COLOR_PICKER §8.2)', () => {
  it('takes the line boxes of the text, in page coordinates, and skips hidden and visually hidden text', () => {
    document.body.innerHTML = '<p id="copy">pick a color, paint the page<span class="sr-only">hidden</span></p><p id="empty">   </p>';
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
      const text = this.startContainer.textContent ?? '';
      // Two lines for the copy, a clipped pixel for the sr-only text.
      return (text === 'hidden' ? [rect(0, 0, 1, 1)] : [rect(100, 40, 600, 48), rect(100, 92, 320, 48)]) as unknown as DOMRectList;
    });
    const rects = lineRects(document.querySelectorAll('#copy, #empty'), 0, 1000);
    expect(rects).toEqual([
      { x: 100, y: 1040, width: 600, height: 48 },
      { x: 100, y: 1092, width: 320, height: 48 },
    ]);
    document.body.innerHTML = '';
  });
});

describe('where a jump spreads from (COLOR_PICKER §8.3)', () => {
  it('an inline panel spreads from its own rounded box, a point from itself', () => {
    document.body.innerHTML = '<div id="wrap"><div class="color-picker-inline" style="border-top-left-radius: 20px"></div></div>';
    const panel = document.querySelector('.color-picker-inline')!;
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(rect(800, 200, 256, 320));
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(500);
    expect(bleedOrigin(document.querySelector('#wrap')!)).toEqual({ x: 800, y: 700, width: 256, height: 320, radius: 20 });
    expect(bleedOrigin({ x: 30, y: 4000 })).toEqual({ x: 30, y: 4000, width: 0, height: 0, radius: 0 });
    document.body.innerHTML = '';
  });
});

describe('the paint under the page (COLOR_PICKER §8.2–§8.3)', () => {
  function setup() {
    const renderer = fakeRenderer();
    vi.spyOn(PaintRenderer, 'create').mockReturnValue(renderer as unknown as PaintRenderer);
    // The long frame arrives decoded.
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(1280);
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(3840);
    HTMLImageElement.prototype.decode = () => Promise.resolve();
    return renderer;
  }
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  const lastPaint = (renderer: ReturnType<typeof fakeRenderer>) => renderer.paint.mock.calls.at(-1)!;

  it('the theme picks the scene: the dark theme reads the frame upside down, a switch repaints at once', async () => {
    const renderer = setup();
    root.classList.add('dark');
    global[START_GLOBAL] = '#ff6a3d';
    render(<PickerColorProvider><PaintPage /></PickerColorProvider>);
    expect(renderer.setInvert).toHaveBeenLastCalledWith(true);
    expect(root.dataset['cpPaint']).toBe('fixed');
    root.classList.remove('dark');
    await settle();
    expect(renderer.setInvert).toHaveBeenLastCalledWith(false);
  });

  it("the frame's first appearance spreads out of the hero's panel in the page color's ramp", async () => {
    const renderer = setup();
    global[START_GLOBAL] = '#ff6a3d';
    render(<PickerColorProvider><PickerHero /><PaintPage /></PickerColorProvider>);
    await settle();
    expect(renderer.setFrame).toHaveBeenCalled();
    const [lut, origin] = lastPaint(renderer);
    expect(lut).toEqual(rampLut(heroRamp('#ff6a3d')!.stops));
    expect(origin).not.toBeNull();
  });

  it("an own palette paints the whole picture with the palette's ramp, spreading out of the palette's row", async () => {
    const renderer = setup();
    global[START_GLOBAL] = '#ff6a3d';
    render(<PickerColorProvider><PickerHero /><Palette /><PaintPage /></PickerColorProvider>);
    await settle();
    const palette = within(screen.getByRole('group', { name: 'Page palette' }));
    const swatch = () => palette.getAllByRole('button', { name: /^Color \d+ of \d+/ });
    // The palette's third color, edited: the palette is the visitor's now.
    fireEvent.click(swatch()[2]!);
    const field = palette.getAllByRole('textbox', { name: 'Color value' }).at(-1)!;
    // Typing happens in the field (the panel opens with its area focused).
    field.focus();
    fireEvent.change(field, { target: { value: '#123456' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await settle();
    const colors = swatch().map((button) => /#[\da-f]{6}/.exec(button.getAttribute('aria-label') ?? '')![0]);
    expect(colors[2]).toBe('#123456');
    const [lut, origin] = lastPaint(renderer);
    expect(lut).toEqual(rampLut(paletteRamp(colors)!.stops));
    expect(lut).not.toEqual(rampLut(heroRamp('#ff6a3d')!.stops));
    expect(origin).not.toBeNull();
  });

  it('dragging a slider repaints at once, without a spread', async () => {
    const renderer = setup();
    global[START_GLOBAL] = '#ff6a3d';
    render(<PickerColorProvider><PickerHero /><PaintPage /></PickerColorProvider>);
    await settle();
    const hue = within(screen.getByRole('group', { name: 'Page color' })).getByRole('slider', { name: /Hue/ });
    hue.focus();
    fireEvent.keyDown(hue, { key: 'ArrowRight' });
    await settle();
    expect(lastPaint(renderer)[1]).toBeNull();
  });

  it('without WebGL 2 the flat background stays and nothing is drawn', () => {
    global[START_GLOBAL] = '#ff6a3d';
    render(<PickerColorProvider><PaintPage /></PickerColorProvider>);
    expect(document.querySelector('.cp-paint')).toHaveAttribute('data-mode', 'flat');
    expect(root).not.toHaveAttribute('data-cp-paint');
  });
});

