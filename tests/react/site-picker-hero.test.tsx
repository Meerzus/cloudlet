import { renderToString } from 'react-dom/server';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PickerColorProvider } from '../../apps/site/src/components/picker/picker-color';
import { PickerHero } from '../../apps/site/src/components/picker/picker-hero';
import { START_COLORS, START_GLOBAL } from '../../apps/site/src/lib/landscape';

const root = document.documentElement;
const global = window as unknown as Record<string, unknown>;
const Hero = () => (
  <PickerColorProvider>
    <PickerHero />
  </PickerColorProvider>
);

beforeEach(() => {
  // jsdom has no WebGL 2, no media queries and no intersection observer: the hero falls back to the flat sky.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  window.history.replaceState(null, '', '/color-picker');
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete global[START_GLOBAL];
  root.removeAttribute('data-cp-hour');
  root.removeAttribute('data-cp-top');
  root.style.removeProperty('--cp-color');
});

describe('color picker landing hero (COLOR_PICKER §8.2–8.3)', () => {
  it('renders on the server with the first curated color and paints the swatch from <html>', () => {
    const html = renderToString(<Hero />);
    expect(html).toContain('pick a color');
    expect(html).toContain('aria-label="Pick the sky color"');
    // The start script has set --cp-color by the time this markup paints.
    expect(html).toContain('var(--cp-color)');
  });

  it('takes the color the start script picked and keeps the flat sky without WebGL 2', () => {
    global[START_GLOBAL] = '#1b1f4a';
    render(<Hero />);
    expect(root.dataset['cpHour']).toBe('night');
    expect(root.style.getPropertyValue('--cp-color')).toBe('#1b1f4a');
    expect(document.querySelector('.cp-hero')).toHaveAttribute('data-flat');
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
    window.history.replaceState(null, '', '/color-picker?c=0f3d5c');
    render(<Hero />);
    expect(root.dataset['cpHour']).toBe('storm');
    expect(root.style.getPropertyValue('--cp-color')).toBe('#0f3d5c');
  });

  it('starts from a curated color without ?c=', () => {
    render(<Hero />);
    expect(START_COLORS).toContain(root.style.getPropertyValue('--cp-color'));
  });

  it('a picked color repaints the page and lands in ?c=', async () => {
    global[START_GLOBAL] = '#1b1f4a';
    render(<Hero />);
    fireEvent.click(screen.getByRole('button', { name: 'Pick the sky color' }));
    const field = within(screen.getByRole('dialog', { name: 'Sky color' })).getByRole('textbox', { name: 'Color value' });
    fireEvent.change(field, { target: { value: '#f2b84b' } });
    expect(root.dataset['cpHour']).toBe('day');
    expect(root.style.getPropertyValue('--cp-color')).toBe('#f2b84b');
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(window.location.search).toBe('?c=f2b84b');
  });
});
