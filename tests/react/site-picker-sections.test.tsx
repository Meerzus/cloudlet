import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useLayoutEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Opacity, START_ALPHA } from '../../apps/site/src/components/picker/opacity';
import { Palette } from '../../apps/site/src/components/picker/palette';
import { PickerColorProvider, usePickerColor, type PaintProbe } from '../../apps/site/src/components/picker/picker-color';
import { START_AIM, Tools } from '../../apps/site/src/components/picker/tools';
import { START_GLOBAL } from '../../apps/site/src/lib/picker-start';

const root = document.documentElement;
const global = window as unknown as Record<string, unknown>;
const page = () => root.style.getPropertyValue('--cp-color');

/** The page's paint as the sections see it: red left of x = 200, blue from there. */
const probe: PaintProbe = { colorAt: vi.fn((x: number) => (x < 200 ? '#dc1e28' : '#1e3cc8')) };

/** Puts the fake paint where the page's paint would. */
function WithPaint({ children }: { readonly children: ReactNode }) {
  const { paint } = usePickerColor();
  useLayoutEffect(() => {
    paint.current = probe;
    return () => {
      paint.current = null;
    };
  }, [paint]);
  return children;
}

const withPaint = (children: ReactNode) => render(<PickerColorProvider><WithPaint>{children}</WithPaint></PickerColorProvider>);

beforeEach(() => {
  global[START_GLOBAL] = '#ff6a3d';
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  window.history.replaceState(null, '', '/color-picker');
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete global[START_GLOBAL];
  root.style.removeProperty('--cp-color');
  vi.restoreAllMocks();
  vi.mocked(probe.colorAt).mockClear();
  window.history.replaceState(null, '', '/');
});

describe('the sections have no pictures of their own (COLOR_PICKER §8.5–§8.7)', () => {
  it('Palette, Opacity and Tools draw no canvas and fetch no frame: the page’s paint shows what they change', () => {
    const { container } = render(<PickerColorProvider><Palette /><Opacity /><Tools /></PickerColorProvider>);
    expect(container.querySelector('canvas, img, picture')).toBeNull();
    expect(screen.getByRole('group', { name: 'Page palette' })).toBeInTheDocument();
  });
});

describe('Opacity (COLOR_PICKER §8.6)', () => {
  it('the alpha sets how much of the paint shows within the section, and never the page color', () => {
    render(<PickerColorProvider><Opacity /></PickerColorProvider>);
    // The theme's background over the paint at 1 − alpha, within the section, under its copy and panel.
    const veil = screen.getByTestId('opacity-veil');
    expect(veil.parentElement).toHaveAttribute('id', 'opacity');
    expect(veil.nextElementSibling).toContainElement(screen.getByRole('group', { name: 'Paint color' }));
    expect(veil.style.opacity).toBe(String(1 - START_ALPHA));
    expect(screen.getByTestId('copy-value')).toHaveTextContent('#ff6a3d80');
    const alpha = screen.getByRole('slider', { name: 'Paint opacity' });
    fireEvent.keyDown(alpha, { key: 'End' });
    expect(veil.style.opacity).toBe('0');
    expect(screen.getByTestId('copy-value')).toHaveTextContent(/^#ff6a3d$/);
    fireEvent.keyDown(alpha, { key: 'Home' });
    expect(veil.style.opacity).toBe('1');
    expect(screen.getByTestId('copy-value')).toHaveTextContent('#ff6a3d00');
    expect(page()).toBe('#ff6a3d');
  });

  it('shows the value with its alpha in every format, and the alpha stays as the format changes', () => {
    render(<PickerColorProvider><Opacity /></PickerColorProvider>);
    const panel = screen.getByRole('group', { name: 'Paint color' });
    const radios = within(within(panel).getByRole('group', { name: 'Format' })).getAllByRole('radio');
    const seen: Record<string, string> = {};
    for (const [index, format] of ['hex', 'rgb', 'hsl', 'oklch'].entries()) {
      fireEvent.click(radios[index]!);
      seen[format] = screen.getByTestId('copy-value').textContent ?? '';
      // Only the alpha moved under a rounding format: the page color holds.
      fireEvent.keyDown(screen.getByRole('slider', { name: 'Paint opacity' }), { key: 'ArrowLeft' });
      fireEvent.keyDown(screen.getByRole('slider', { name: 'Paint opacity' }), { key: 'ArrowRight' });
      expect(page(), format).toBe('#ff6a3d');
    }
    expect(seen['hex']).toBe('#ff6a3d80');
    expect(seen['rgb']).toBe('rgb(255 106 61 / 0.5)');
    expect(seen['hsl']).toMatch(/^hsl\(14 100% 62% \/ 0\.5\)$/);
    expect(seen['oklch']).toMatch(/^oklch\([\d.]+% [\d.]+ [\d.]+ \/ 0\.5\)$/);
  });

  it('moving the panel’s color paints the page, the paint keeps its opacity', () => {
    render(<PickerColorProvider><Opacity /></PickerColorProvider>);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Hue' }), { key: 'ArrowRight', shiftKey: true });
    expect(page()).not.toBe('#ff6a3d');
    // The panel says the alpha back in hex: 0x80 / 255.
    expect(Number(screen.getByTestId('opacity-veil').style.opacity)).toBeCloseTo(1 - START_ALPHA, 2);
  });

  it('copies the value with its alpha', async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<PickerColorProvider><Opacity /></PickerColorProvider>);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy #ff6a3d80' })));
    expect(writeText).toHaveBeenCalledWith('#ff6a3d80');
    expect(screen.getByText('Copied #ff6a3d80')).toBeInTheDocument();
  });
});

describe('Tools (COLOR_PICKER §8.7)', () => {
  const section = () => document.getElementById('tools')!;
  const paintButton = () => screen.getByRole('button', { name: 'Take a color from the paint' });
  const box = () =>
    vi.spyOn(section(), 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0, toJSON() {} } as DOMRect);

  it('a click on the paint in the section takes the color it shows there and makes it the page color, spreading from that point', () => {
    withPaint(<Tools />);
    box();
    fireEvent.click(section(), { clientX: 350, clientY: 100, detail: 1 });
    expect(page()).toBe('#1e3cc8');
    expect(probe.colorAt).toHaveBeenLastCalledWith(350, 100);
    expect(screen.getByText('Page color #1e3cc8')).toBeInTheDocument();
    // Over the copy is over the paint too.
    fireEvent.click(screen.getByRole('heading', { name: 'tools' }), { clientX: 20, clientY: 40, detail: 1 });
    expect(page()).toBe('#dc1e28');
  });

  it('a click on a control is the control’s, not the paint’s', () => {
    withPaint(<Tools />);
    box();
    const formats = screen.getByRole('group', { name: 'The same color in four formats' });
    fireEvent.click(within(formats).getAllByRole('button')[0]!, { clientX: 350, clientY: 100, detail: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Open the tools picker' }), { clientX: 350, clientY: 100, detail: 1 });
    expect(probe.colorAt).not.toHaveBeenCalled();
    expect(page()).toBe('#ff6a3d');
  });

  it('from the keyboard the arrows move a crosshair over the section and Enter takes the color under it', () => {
    withPaint(<Tools />);
    box();
    expect(paintButton()).toHaveAccessibleDescription('Arrow keys move the crosshair, Enter takes the color under it.');
    // The crosshair starts in the open paint on the right: blue. Shift+← five times moves it into the red.
    fireEvent.click(paintButton(), { detail: 0 });
    expect(probe.colorAt).toHaveBeenLastCalledWith(START_AIM.x * 400, START_AIM.y * 200);
    expect(page()).toBe('#1e3cc8');
    for (let step = 0; step < 5; step += 1) fireEvent.keyDown(paintButton(), { key: 'ArrowLeft', shiftKey: true });
    fireEvent.click(paintButton(), { detail: 0 });
    expect(page()).toBe('#dc1e28');
  });

  it('without the page’s paint a click changes nothing', () => {
    render(<PickerColorProvider><Tools /></PickerColorProvider>);
    box();
    fireEvent.click(section(), { clientX: 350, clientY: 100, detail: 1 });
    expect(page()).toBe('#ff6a3d');
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

  it('the compact picker is a swatch that opens into the panel', () => {
    render(<PickerColorProvider><Tools /></PickerColorProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open the tools picker' }));
    expect(screen.getByRole('dialog', { name: 'Tools picker' })).toBeInTheDocument();
  });
});
