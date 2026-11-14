import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { driftAt, driftingGlassShader, DRIFT, DRIFT_ZOOM } from '../../apps/site/src/components/picker/fluted-glass';
import { Opacity, START_ALPHA } from '../../apps/site/src/components/picker/opacity';
import { PickerColorProvider } from '../../apps/site/src/components/picker/picker-color';
import { Tools } from '../../apps/site/src/components/picker/tools';
import { averageHex, framePoint } from '../../apps/site/src/lib/frame-sample';
import { START_GLOBAL } from '../../apps/site/src/lib/picker-start';

const root = document.documentElement;
const global = window as unknown as Record<string, unknown>;
const page = () => root.style.getPropertyValue('--cp-color');

/** A 40 × 20 picture: the left half red, the right half blue. */
const PICTURE = { width: 40, height: 20 };
const pictureData = () => {
  const data = new Uint8ClampedArray(PICTURE.width * PICTURE.height * 4);
  for (let y = 0; y < PICTURE.height; y += 1)
    for (let x = 0; x < PICTURE.width; x += 1) data.set(x < PICTURE.width / 2 ? [220, 30, 40, 255] : [30, 60, 200, 255], (y * PICTURE.width + x) * 4);
  return data;
};

let near: ((entries: { isIntersecting: boolean }[]) => void)[] = [];

beforeEach(() => {
  global[START_GLOBAL] = '#ff6a3d';
  near = [];
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  // jsdom has no WebGL 2: the glass falls back to the plain picture. A 2D context reads the fake picture.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, kind: string) {
    if (kind !== '2d') return null;
    return { drawImage() {}, getImageData: () => ({ data: pictureData() }) } as unknown as CanvasRenderingContext2D;
  } as never);
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        near.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  window.history.replaceState(null, '', '/color-picker');
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete global[START_GLOBAL];
  root.style.removeProperty('--cp-color');
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

/** Brings every card within reach, as scrolling would, so their pictures mount. */
const scrollNear = () => act(() => near.forEach((callback) => callback([{ isIntersecting: true }])));

describe('Opacity (COLOR_PICKER §8.6)', () => {
  it('the alpha sets the film and never the page color', () => {
    render(<PickerColorProvider><Opacity /></PickerColorProvider>);
    const film = screen.getByTestId('opacity-film');
    expect(film.style.opacity).toBe(String(START_ALPHA));
    expect(screen.getByTestId('copy-value')).toHaveTextContent('#ff6a3d80');
    const alpha = screen.getByRole('slider', { name: 'Film opacity' });
    fireEvent.keyDown(alpha, { key: 'End' });
    expect(film.style.opacity).toBe('1');
    expect(screen.getByTestId('copy-value')).toHaveTextContent(/^#ff6a3d$/);
    fireEvent.keyDown(alpha, { key: 'Home' });
    expect(film.style.opacity).toBe('0');
    expect(screen.getByTestId('copy-value')).toHaveTextContent('#ff6a3d00');
    expect(page()).toBe('#ff6a3d');
  });

  it('shows the value with its alpha in every format, and the alpha stays as the format changes', () => {
    render(<PickerColorProvider><Opacity /></PickerColorProvider>);
    const panel = screen.getByRole('group', { name: 'Film color' });
    const radios = within(within(panel).getByRole('group', { name: 'Format' })).getAllByRole('radio');
    const seen: Record<string, string> = {};
    for (const [index, format] of ['hex', 'rgb', 'hsl', 'oklch'].entries()) {
      fireEvent.click(radios[index]!);
      seen[format] = screen.getByTestId('copy-value').textContent ?? '';
      // Only the alpha moved under a rounding format: the page color holds.
      fireEvent.keyDown(screen.getByRole('slider', { name: 'Film opacity' }), { key: 'ArrowLeft' });
      fireEvent.keyDown(screen.getByRole('slider', { name: 'Film opacity' }), { key: 'ArrowRight' });
      expect(page(), format).toBe('#ff6a3d');
    }
    expect(seen['hex']).toBe('#ff6a3d80');
    expect(seen['rgb']).toBe('rgb(255 106 61 / 0.5)');
    expect(seen['hsl']).toMatch(/^hsl\(14 100% 62% \/ 0\.5\)$/);
    expect(seen['oklch']).toMatch(/^oklch\([\d.]+% [\d.]+ [\d.]+ \/ 0\.5\)$/);
  });

  it('moving the panel’s color paints the page, the film keeps its density', () => {
    render(<PickerColorProvider><Opacity /></PickerColorProvider>);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Hue' }), { key: 'ArrowRight', shiftKey: true });
    expect(page()).not.toBe('#ff6a3d');
    // The panel says the alpha back in hex: 0x80 / 255.
    expect(Number(screen.getByTestId('opacity-film').style.opacity)).toBeCloseTo(START_ALPHA, 2);
  });

  it('copies the value with its alpha', async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<PickerColorProvider><Opacity /></PickerColorProvider>);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy #ff6a3d80' })));
    expect(writeText).toHaveBeenCalledWith('#ff6a3d80');
    expect(screen.getByText('Copied #ff6a3d80')).toBeInTheDocument();
  });

  it('without WebGL 2 the card is the plain picture, no glass', () => {
    const { container } = render(<PickerColorProvider><Opacity /></PickerColorProvider>);
    // Before the card comes near, nothing is fetched.
    expect(container.querySelector('.cp-glass-image')).toBeNull();
    scrollNear();
    const picture = container.querySelector<HTMLImageElement>('.cp-glass-image')!;
    expect(picture.getAttribute('src')).toBe('/picker/material-opacity-1280.webp');
    expect(picture).toBeVisible();
    expect(container.querySelector('.cp-glass-card')).not.toHaveAttribute('data-glass');
  });
});

describe('Tools (COLOR_PICKER §8.7)', () => {
  /** The picture, loaded as far as the card can tell. */
  const loaded = (container: HTMLElement) => {
    const picture = container.querySelector<HTMLImageElement>('.cp-glass-image')!;
    Object.defineProperty(picture, 'naturalWidth', { value: PICTURE.width });
    Object.defineProperty(picture, 'naturalHeight', { value: PICTURE.height });
    return picture;
  };
  const card = () => screen.getByRole('button', { name: 'Take a color from the flowers' });
  const box = (element: HTMLElement) =>
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0, toJSON() {} } as DOMRect);

  it('a click on the frame takes the color under the pointer off the picture and makes it the page color', () => {
    const { container } = render(<PickerColorProvider><Tools /></PickerColorProvider>);
    scrollNear();
    loaded(container);
    box(card());
    fireEvent.click(card(), { clientX: 350, clientY: 100, detail: 1 });
    expect(page()).toBe('#1e3cc8');
    expect(screen.getByText('Page color #1e3cc8')).toBeInTheDocument();
    fireEvent.click(card(), { clientX: 20, clientY: 40, detail: 1 });
    expect(page()).toBe('#dc1e28');
  });

  it('from the keyboard the arrows move a crosshair and Enter takes the color under it', () => {
    const { container } = render(<PickerColorProvider><Tools /></PickerColorProvider>);
    scrollNear();
    loaded(container);
    box(card());
    expect(card()).toHaveAccessibleDescription('Arrow keys move the crosshair, Enter takes the color under it.');
    // The crosshair starts left of the middle: red. Shift+→ three times moves it into the blue half.
    fireEvent.click(card(), { detail: 0 });
    expect(page()).toBe('#dc1e28');
    for (let step = 0; step < 3; step += 1) fireEvent.keyDown(card(), { key: 'ArrowRight', shiftKey: true });
    fireEvent.click(card(), { detail: 0 });
    expect(page()).toBe('#1e3cc8');
  });

  it('the row of four formats copies each one', async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<PickerColorProvider><Tools /></PickerColorProvider>);
    const row = screen.getByRole('group', { name: 'The same color in four formats' });
    const buttons = within(row).getAllByRole('button');
    // Each button's name is its visible text with "Copy" before it.
    const names = buttons.map((button) => button.textContent!.replace(/\s+/g, ' ').trim());
    expect(names).toEqual(['Copy hex #ff6a3d', 'Copy rgb rgb(255 106 61)', 'Copy hsl hsl(14 100% 62%)', expect.stringMatching(/^Copy oklch oklch\(/)]);
    for (const button of buttons) await act(async () => fireEvent.click(button));
    expect(writeText.mock.calls.map(([text]) => text)).toEqual(names.map((name) => name.replace(/^Copy \w+ /, '')));
    expect(buttons.at(-1)).toHaveAttribute('data-copied');
    expect(screen.getByText(/^Copied oklch\(/)).toBeInTheDocument();
  });

  it('the compact picker is a swatch that opens into the panel, and without WebGL 2 the card is the plain picture', () => {
    const { container } = render(<PickerColorProvider><Tools /></PickerColorProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open the tools picker' }));
    expect(screen.getByRole('dialog', { name: 'Tools picker' })).toBeInTheDocument();
    scrollNear();
    expect(container.querySelector('.cp-glass-image')).toBeVisible();
    expect(container.querySelector('.cp-glass-card')).not.toHaveAttribute('data-glass');
  });
});

describe('the glass and the frame (COLOR_PICKER §8.3, §8.8)', () => {
  it('adds the drift to the pinned Paper shader, and refuses one it no longer fits', () => {
    const shader = driftingGlassShader();
    expect(shader).toContain('uniform vec2 u_drift;');
    expect(shader).toContain('uv = (uv - .5) * u_zoom + .5 + u_drift;');
    expect(() => driftingGlassShader('void main() {}')).toThrow(/no longer applies/);
  });

  it('drifts in a loop inside the room the zoom leaves', () => {
    for (let time = 0; time < DRIFT.period; time += 500) {
      const [x, y] = driftAt(time);
      expect(Math.abs(x)).toBeLessThanOrEqual(DRIFT.amplitude);
      expect(Math.abs(y)).toBeLessThanOrEqual(DRIFT.amplitude);
    }
    expect(driftAt(DRIFT.period + 1234)).toEqual(driftAt(1234));
    expect(DRIFT_ZOOM).toBeCloseTo(1 - 2 * DRIFT.amplitude);
  });

  it('maps a point on the card to the picture as object-fit: cover shows it, then zoom and drift', () => {
    // A 16:9 picture on a 4:3 card: cover crops its sides.
    const box = { width: 400, height: 300 };
    const image = { width: 1600, height: 900 };
    expect(framePoint(200, 150, box, image)).toEqual({ u: 0.5, v: 0.5 });
    const left = framePoint(0, 0, box, image);
    expect(left.v).toBe(0);
    expect(left.u).toBeCloseTo((1600 - (400 * 900) / 300) / 2 / 1600);
    const zoomed = framePoint(0, 0, box, image, [0.02, -0.01], 0.9);
    expect(zoomed.u).toBeCloseTo((left.u - 0.5) * 0.9 + 0.5 + 0.02);
    expect(zoomed.v).toBeCloseTo((0 - 0.5) * 0.9 + 0.5 - 0.01);
  });

  it('averages the pixels around the point, inside the picture', () => {
    // 4 × 2: two red columns, two blue.
    const data = new Uint8ClampedArray(4 * 2 * 4);
    for (let at = 0; at < 8; at += 1) data.set(at % 4 < 2 ? [220, 30, 40, 255] : [30, 60, 200, 255], at * 4);
    expect(averageHex(data, 4, 2, 0, 0, 0)).toBe('#dc1e28');
    expect(averageHex(data, 4, 2, 3, 1, 0)).toBe('#1e3cc8');
    // Around (1, 0): four red pixels and two blue, the edge of the picture cutting the rest.
    expect(averageHex(data, 4, 2, 1, 0, 1)).toBe('#9d285d');
  });
});
