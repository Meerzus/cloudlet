import { renderToString } from 'react-dom/server';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PickerColorProvider } from '../../apps/site/src/components/picker/picker-color';
import { PickerHero } from '../../apps/site/src/components/picker/picker-hero';
import { START_COLORS, START_GLOBAL } from '../../apps/site/src/lib/picker-start';

const root = document.documentElement;
const global = window as unknown as Record<string, unknown>;
const Hero = () => (
  <PickerColorProvider>
    <PickerHero />
  </PickerColorProvider>
);

beforeEach(() => {
  // jsdom has no WebGL 2, no media queries and no intersection observer: the hero falls back to the flat background.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  window.history.replaceState(null, '', '/color-picker');
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete global[START_GLOBAL];
  root.removeAttribute('data-cp-scene');
  root.removeAttribute('data-cp-top');
  root.style.removeProperty('--cp-color');
});

const panel = () => screen.getByRole('group', { name: 'Page color' });

describe('color picker landing hero (COLOR_PICKER §8.2–8.4)', () => {
  it('renders on the server with the copy, the open panel and the frames for the shader', () => {
    const html = renderToString(<Hero />);
    expect(html).toContain('pick a color,');
    expect(html).toContain('paint the page');
    expect(html).toContain('One shadcn item, no dependencies.');
    expect(html).toContain('aria-label="Page color"');
    expect(html).toContain('color-picker-inline');
    // No swatch to click: the panel is open from the start.
    expect(html).not.toContain('aria-expanded');
    // Wide frame by default, the tall one on a phone; AVIF first, WebP behind it.
    expect(html).toContain('material-hero-2560.avif');
    expect(html).toContain('material-hero-tall-720.avif');
    expect(html).toContain('src="/picker/material-hero-1280.webp"');
    // Until the start color is known the panel stays hidden (picker.css): the section is not started.
    expect(html).not.toContain('data-started');
  });

  it('takes the color the start script picked and keeps the flat background without WebGL 2', () => {
    global[START_GLOBAL] = '#1b1f4a';
    render(<Hero />);
    expect(root.dataset['cpScene']).toBe('dark');
    expect(root.style.getPropertyValue('--cp-color')).toBe('#1b1f4a');
    const hero = document.querySelector('.cp-hero')!;
    expect(hero).toHaveAttribute('data-flat');
    expect(hero).toHaveAttribute('data-started');
    expect(hero).not.toHaveAttribute('data-ready');
    expect(within(panel()).getByRole('textbox', { name: 'Color value' })).toHaveValue('#1b1f4a');
    // Nothing changed yet: the address stays as it was.
    expect(window.location.search).toBe('');
  });

  it("uses the start script's color once, so a client navigation back picks afresh", async () => {
    global[START_GLOBAL] = '#1b1f4a';
    render(<Hero />);
    expect(global[START_GLOBAL]).toBe('#1b1f4a');
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(global[START_GLOBAL]).toBeUndefined();
  });

  it('starts from ?c= after a client navigation, when the start script did not run', () => {
    window.history.replaceState(null, '', '/color-picker?c=f2b84b');
    render(<Hero />);
    expect(root.dataset['cpScene']).toBe('light');
    expect(root.style.getPropertyValue('--cp-color')).toBe('#f2b84b');
  });

  it('starts from a curated color without ?c=', () => {
    render(<Hero />);
    expect(START_COLORS).toContain(root.style.getPropertyValue('--cp-color'));
  });

  it('a color typed into the panel repaints the page, switches the scene and lands in ?c=', async () => {
    global[START_GLOBAL] = '#1b1f4a';
    render(<Hero />);
    const field = within(panel()).getByRole('textbox', { name: 'Color value' });
    fireEvent.change(field, { target: { value: '#f2b84b' } });
    expect(root.dataset['cpScene']).toBe('light');
    expect(root.style.getPropertyValue('--cp-color')).toBe('#f2b84b');
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(window.location.search).toBe('?c=f2b84b');
  });

  it('the panel has no opacity: that lives in its own section', () => {
    global[START_GLOBAL] = '#ff6a3d';
    render(<Hero />);
    expect(within(panel()).queryByRole('slider', { name: /Opacity/ })).toBeNull();
    expect(within(panel()).getByRole('slider', { name: /Hue/ })).toBeInTheDocument();
  });
});
