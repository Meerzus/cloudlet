import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Keyboards } from '../../apps/site/src/components/picker/keyboards';
import { Palette } from '../../apps/site/src/components/picker/palette';
import { followersOf, PickerColorProvider } from '../../apps/site/src/components/picker/picker-color';
import { PickerHero } from '../../apps/site/src/components/picker/picker-hero';
import { harmoniesOf } from '../../apps/site/src/lib/harmonies';
import { START_GLOBAL } from '../../apps/site/src/lib/picker-start';

const root = document.documentElement;
const global = window as unknown as Record<string, unknown>;

beforeEach(() => {
  global[START_GLOBAL] = '#ff6a3d';
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  // jsdom has no WebGL 2 and no observers: the material falls back to the flat background.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  window.history.replaceState(null, '', '/color-picker');
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete global[START_GLOBAL];
  root.removeAttribute('data-cp-scene');
  root.style.removeProperty('--cp-color');
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

const palette = () => screen.getByRole('group', { name: 'Page palette' });
/** The palette's colors as its swatches say them ("Color 2 of 3, #2f8f9d"). */
const swatches = () =>
  within(palette())
    .getAllByRole('button', { name: /^Color \d+ of \d+/ })
    .map((button) => /#[\da-f]{6}/.exec(button.getAttribute('aria-label') ?? '')![0]);
const typeInto = (field: HTMLElement, value: string) => {
  fireEvent.change(field, { target: { value } });
};
/** Opens a palette swatch's picker and types a color into it. */
const editSwatch = (index: number, value: string) => {
  fireEvent.click(within(palette()).getAllByRole('button', { name: /^Color \d+ of \d+/ })[index]!);
  const fields = within(palette()).getAllByRole('textbox', { name: 'Color value' });
  typeInto(fields.at(-1)!, value);
  fireEvent.keyDown(fields.at(-1)!, { key: 'Enter' });
};

describe('color picker landing scenes (COLOR_PICKER §8.5)', () => {
  it('Palette: the first color is the page color, the others follow it until the visitor edits them', () => {
    render(<PickerColorProvider><PickerHero /><Palette /></PickerColorProvider>);
    expect(swatches()).toEqual(['#ff6a3d', ...followersOf('#ff6a3d')]);
    // The hero's panel moves the page color, and the untouched palette follows it.
    typeInto(within(screen.getByRole('group', { name: 'Page color' })).getByRole('textbox', { name: 'Color value' }), '#2f8f9d');
    expect(swatches()).toEqual(['#2f8f9d', ...followersOf('#2f8f9d')]);
    // The palette's first color moves the page, and the palette still follows.
    editSwatch(0, '#f2b84b');
    expect(root.style.getPropertyValue('--cp-color')).toBe('#f2b84b');
    expect(root.dataset['cpScene']).toBe('light');
    expect(swatches()).toEqual(['#f2b84b', ...followersOf('#f2b84b')]);
    // Editing another color makes the palette the visitor's: it no longer follows the page color.
    editSwatch(2, '#123456');
    const own = swatches();
    expect(own).toEqual(['#f2b84b', followersOf('#f2b84b')[0], '#123456']);
    typeInto(within(screen.getByRole('group', { name: 'Page color' })).getByRole('textbox', { name: 'Color value' }), '#1b1f4a');
    expect(swatches()).toEqual(['#1b1f4a', ...own.slice(1)]);
    expect(root.dataset['cpScene']).toBe('dark');
  });

  it('Palette: a format switch keeps it following, the smallest nudge of another color makes it the visitor\'s', () => {
    render(<PickerColorProvider><Palette /></PickerColorProvider>);
    const followers = followersOf('#ff6a3d');
    const open = (index: number) => fireEvent.click(within(palette()).getAllByRole('button', { name: /^Color \d+ of \d+/ })[index]!);
    // hsl() rounds every channel: the palette re-emits the followers in other words and still follows.
    open(0);
    fireEvent.click(within(palette()).getByRole('radio', { name: 'hsl' }));
    fireEvent.keyDown(within(palette()).getByRole('slider', { name: 'Saturation and brightness' }), { key: 'Escape' });
    open(0);
    fireEvent.click(within(palette()).getByRole('radio', { name: 'hex' }));
    expect(swatches()).toEqual(['#ff6a3d', ...followers]);
    // One percent of saturation on the second color moves a channel by a unit or two: still an edit.
    open(1);
    const area = within(palette()).getAllByRole('slider', { name: 'Saturation and brightness' }).at(-1)!;
    fireEvent.keyDown(area, { key: 'ArrowLeft' });
    const nudged = swatches()[1];
    expect(nudged).not.toBe(followers[0]);
    expect(swatches()).toEqual(['#ff6a3d', nudged, followers[1]]);
  });

  it('Palette: a hint fills the palette from the page color, and the palette lands in ?c=', async () => {
    render(<PickerColorProvider><Palette /></PickerColorProvider>);
    const hints = within(screen.getByRole('group', { name: 'Start from a harmony' })).getAllByRole('button');
    expect(hints.map((hint) => hint.textContent)).toEqual(['Complement', 'Split complement', 'Analogous', 'Tints']);
    const tints = screen.getByRole('button', { name: 'Tints' });
    expect(tints).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Split complement' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(tints);
    const colors = harmoniesOf('#ff6a3d')[3]!.colors;
    expect(swatches()).toEqual(colors);
    expect(tints).toHaveAttribute('aria-pressed', 'true');
    expect(root.style.getPropertyValue('--cp-color')).toBe('#ff6a3d');
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(window.location.search).toBe(`?c=${colors.map((hex) => hex.slice(1)).join(',')}`);
  });

  it('Palette: a link with ?c=a,b,c brings the palette back as the visitor made it', () => {
    delete global[START_GLOBAL];
    window.history.replaceState(null, '', '/color-picker?c=1b1f4a,f2b84b,9be7a8');
    render(<PickerColorProvider><Palette /></PickerColorProvider>);
    expect(swatches()).toEqual(['#1b1f4a', '#f2b84b', '#9be7a8']);
    expect(root.style.getPropertyValue('--cp-color')).toBe('#1b1f4a');
    // No hint matches a palette someone made.
    for (const hint of within(screen.getByRole('group', { name: 'Start from a harmony' })).getAllByRole('button')) expect(hint).toHaveAttribute('aria-pressed', 'false');
  });

  it('Palette: one Tab stop for the whole palette, then the hints', () => {
    render(<PickerColorProvider><Palette /></PickerColorProvider>);
    const palette = screen.getByRole('group', { name: 'Page palette' });
    const stops = within(palette).getAllByRole('button').filter((button) => button.tabIndex === 0);
    expect(stops).toHaveLength(1);
  });

  it('Built for keyboards: the inline panel paints the page, pressed keys light up, the switch stills the morph', () => {
    render(<PickerColorProvider><Keyboards /></PickerColorProvider>);
    const area = screen.getByRole('slider', { name: 'Saturation and brightness' });
    const arrow = screen.getByText('→');
    fireEvent.keyDown(area, { key: 'ArrowRight' });
    expect(arrow).toHaveAttribute('data-pressed');
    expect(root.style.getPropertyValue('--cp-color')).not.toBe('#ff6a3d');
    fireEvent.keyUp(area, { key: 'ArrowRight' });
    expect(arrow).not.toHaveAttribute('data-pressed');

    const swatch = screen.getByRole('button', { name: 'Open the motion demo picker' });
    const demo = swatch.closest('.cp-motion-demo')!;
    expect(demo).not.toHaveAttribute('data-reduced-motion');
    fireEvent.click(screen.getByRole('switch', { name: 'Reduce motion' }));
    expect(screen.getByRole('switch', { name: 'Reduce motion' })).toHaveAttribute('aria-checked', 'true');
    expect(demo).toHaveAttribute('data-reduced-motion');
  });
});
