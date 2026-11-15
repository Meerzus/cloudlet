import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorPalette, type ColorPaletteProps } from '@/components/ui/color-palette/color-palette';
import { parseColor, rgbToOklch } from '@/components/ui/color-picker/color';

/** A controlled owner: the palette sees what it last emitted. */
function Owner({ initial = ['#ff0000', '#00ff00'], onChange = () => {}, ...props }: Omit<ColorPaletteProps, 'colors' | 'onChange'> & { initial?: string[]; onChange?: (colors: string[]) => void }) {
  const [colors, setColors] = useState(initial);
  return (
    <>
      <ColorPalette {...props} colors={colors} onChange={(next) => { setColors(next); onChange(next); }} />
      <output data-testid="value">{colors.join(' ')}</output>
      <button type="button" onClick={() => setColors(['#336699'])}>Set one</button>
    </>
  );
}

const group = () => screen.getByRole('group', { name: 'Palette' });
const swatches = () => within(group()).getAllByRole('button', { name: /^Color \d of \d/ });
const addButton = () => within(group()).queryByRole('button', { name: 'Add color' });
const removeButtons = () => within(group()).queryAllByRole('button', { name: 'Remove color' });
const value = () => screen.getByTestId('value').textContent;
const stops = () => [...swatches(), ...(addButton() ? [addButton()!] : [])];
const tabbable = () => stops().filter((element) => element.getAttribute('tabindex') !== '-1');
const hue = (color: string) => rgbToOklch(parseColor(color)!).h;

describe('ColorPalette', () => {
  it('is a named group of swatches, each named with its place, the count and its value', () => {
    render(<ColorPalette defaultColors={['#ff6a3d', '#2f8f9d']} labels={{ group: 'Brand palette' }} />);
    const palette = screen.getByRole('group', { name: 'Brand palette' });
    expect(within(palette).getAllByRole('button', { name: /^Color/ }).map((button) => button.getAttribute('aria-label'))).toEqual(['Color 1 of 2, #ff6a3d', 'Color 2 of 2, #2f8f9d']);
  });

  it('owns its colors when uncontrolled and reports the whole array', () => {
    const onChange = vi.fn();
    render(<ColorPalette defaultColors={['#ff0000']} onChange={onChange} />);
    fireEvent.click(addButton()!);
    expect(onChange).toHaveBeenCalledTimes(1);
    const [colors] = onChange.mock.calls[0] as [string[]];
    expect(colors).toHaveLength(2);
    expect(colors[0]).toBe('#ff0000');
    expect(swatches()).toHaveLength(2);
  });

  it('follows the colors it is given when controlled', () => {
    render(<Owner />);
    expect(swatches()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Set one' }));
    expect(swatches().map((button) => button.getAttribute('aria-label'))).toEqual(['Color 1 of 1, #336699']);
  });

  it('treats an empty array as one default color', () => {
    render(<ColorPalette colors={[]} />);
    expect(swatches()).toHaveLength(1);
    expect(removeButtons()).toHaveLength(0);
  });

  it('adds colors up to max, opens the new color’s picker at once, and hides the add button at max', () => {
    render(<Owner initial={['#ff0000']} max={3} />);
    fireEvent.click(addButton()!);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('slider', { name: 'Saturation and brightness' })).toHaveFocus();
    expect(swatches()[1]).toHaveAttribute('aria-expanded', 'true');
    const [first, second] = value()!.split(' ') as [string, string];
    // The new color is the last one turned in OKLCH hue: 360° / max apart.
    expect(Math.round((hue(second) - hue(first) + 360) % 360)).toBe(120);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(addButton()!);
    expect(swatches()).toHaveLength(3);
    expect(addButton()).not.toBeInTheDocument();
  });

  it('steps a grey in lightness, since it has no hue to turn', () => {
    render(<Owner initial={['#ffffff']} />);
    fireEvent.click(addButton()!);
    const [, added] = value()!.split(' ') as [string, string];
    expect(added).not.toBe('#ffffff');
    expect(rgbToOklch(parseColor(added)!).l).toBeLessThan(0.75);
  });

  it('removes colors down to one with the pointer, and the remove buttons go with the last but one', () => {
    render(<Owner initial={['#ff0000', '#00ff00', '#0000ff']} />);
    expect(removeButtons()).toHaveLength(3);
    fireEvent.click(removeButtons()[1]!);
    expect(value()).toBe('#ff0000 #0000ff');
    fireEvent.click(removeButtons()[0]!);
    expect(value()).toBe('#0000ff');
    expect(removeButtons()).toHaveLength(0);
  });

  it('is one Tab stop: arrows move between the swatches and the add button, Home and End jump to the ends', () => {
    render(<Owner initial={['#ff0000', '#00ff00', '#0000ff']} />);
    expect(tabbable()).toEqual([swatches()[0]]);
    swatches()[0]!.focus();
    fireEvent.keyDown(swatches()[0]!, { key: 'ArrowRight' });
    expect(swatches()[1]).toHaveFocus();
    expect(tabbable()).toEqual([swatches()[1]]);
    fireEvent.keyDown(swatches()[1]!, { key: 'End' });
    expect(addButton()).toHaveFocus();
    expect(tabbable()).toEqual([addButton()]);
    fireEvent.keyDown(addButton()!, { key: 'ArrowRight' });
    expect(addButton()).toHaveFocus();
    fireEvent.keyDown(addButton()!, { key: 'ArrowLeft' });
    expect(swatches()[2]).toHaveFocus();
    fireEvent.keyDown(swatches()[2]!, { key: 'Home' });
    expect(swatches()[0]).toHaveFocus();
    fireEvent.keyDown(swatches()[0]!, { key: 'ArrowLeft' });
    expect(swatches()[0]).toHaveFocus();
    // The remove buttons are for the pointer: never a Tab stop.
    for (const button of removeButtons()) expect(button).toHaveAttribute('tabindex', '-1');
  });

  it('opens a swatch’s picker with Enter like any button and leaves the arrows inside it alone', () => {
    render(<Owner />);
    fireEvent.click(swatches()[1]!);
    const dialog = screen.getByRole('dialog');
    const area = within(dialog).getByRole('slider', { name: 'Saturation and brightness' });
    fireEvent.keyDown(area, { key: 'ArrowLeft' });
    expect(area).toHaveFocus();
    expect(value()!.split(' ')[1]).not.toBe('#00ff00');
    expect(value()!.split(' ')[0]).toBe('#ff0000');
  });

  it('removes the focused color with Delete or Backspace and hands the focus to its neighbour', () => {
    render(<Owner initial={['#ff0000', '#00ff00', '#0000ff']} />);
    swatches()[1]!.focus();
    fireEvent.keyDown(swatches()[1]!, { key: 'Delete' });
    expect(value()).toBe('#ff0000 #0000ff');
    expect(swatches()[1]).toHaveFocus();
    expect(swatches()[1]).toHaveAccessibleName('Color 2 of 2, #0000ff');
    fireEvent.keyDown(swatches()[1]!, { key: 'Backspace' });
    expect(value()).toBe('#ff0000');
    // The last one left takes the focus; with one color Delete does nothing.
    expect(swatches()[0]).toHaveFocus();
    fireEvent.keyDown(swatches()[0]!, { key: 'Delete' });
    expect(value()).toBe('#ff0000');
    fireEvent.keyDown(addButton()!, { key: 'Delete' });
    expect(value()).toBe('#ff0000');
  });

  it('announces a removal politely', () => {
    render(<Owner initial={['#ff0000', '#00ff00', '#0000ff']} labels={{ removed: 'Gone' }} />);
    const live = group().querySelector('[aria-live="polite"]')!;
    expect(live).toHaveTextContent('');
    fireEvent.click(removeButtons()[0]!);
    expect(live.textContent?.trim()).toBe('Gone');
    // A second removal changes the text, so it is spoken again.
    const first = live.textContent;
    fireEvent.click(removeButtons()[0]!);
    expect(live.textContent?.trim()).toBe('Gone');
    expect(live.textContent).not.toBe(first);
  });

  it('reports every color in `format`, whatever syntax it came in', () => {
    const onChange = vi.fn();
    render(<Owner initial={['#ff0000', 'rgb(0 0 255)']} format="hsl" onChange={onChange} />);
    expect(swatches()[1]).toHaveAccessibleName('Color 2 of 2, hsl(240 100% 50%)');
    fireEvent.click(swatches()[0]!);
    fireEvent.keyDown(within(screen.getByRole('dialog')).getByRole('slider', { name: 'Hue' }), { key: 'ArrowRight', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(['hsl(10 100% 50%)', 'hsl(240 100% 50%)']);
  });

  it('re-emits every color when the format changes in any picker', () => {
    const onChange = vi.fn();
    const onFormatChange = vi.fn();
    render(<Owner initial={['#ff0000', '#0000ff']} onChange={onChange} onFormatChange={onFormatChange} />);
    fireEvent.click(swatches()[1]!);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: 'rgb' }));
    expect(onFormatChange).toHaveBeenCalledWith('rgb');
    expect(onChange).toHaveBeenLastCalledWith(['rgb(255 0 0)', 'rgb(0 0 255)']);
    expect(value()).toBe('rgb(255 0 0) rgb(0 0 255)');
    expect(swatches()[0]).toHaveAccessibleName('Color 1 of 2, rgb(255 0 0)');
  });

  it('drops alpha unless the palette shows it', () => {
    const { unmount } = render(<ColorPalette defaultColors={['#ff000080']} name="c" />);
    expect(swatches()[0]).toHaveAccessibleName('Color 1 of 1, #ff0000');
    unmount();
    render(<ColorPalette defaultColors={['#ff000080']} alpha name="c" />);
    expect(swatches()[0]).toHaveAccessibleName('Color 1 of 1, #ff000080');
  });

  it('travels with a native form: one hidden input per color under `name`', () => {
    render(<form aria-label="Form"><Owner initial={['#ff0000', 'rgb(0 255 0)']} name="palette" /></form>);
    const form = screen.getByRole('form', { name: 'Form' }) as HTMLFormElement;
    expect(new FormData(form).getAll('palette')).toEqual(['#ff0000', '#00ff00']);
    fireEvent.click(removeButtons()[0]!);
    expect(new FormData(form).getAll('palette')).toEqual(['#00ff00']);
  });
});

describe('ColorPalette motion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  });

  /** A Web Animations stand-in: records the palette's keyframes (the picker's morph has its own). */
  const animate = () => {
    const calls: { node: Element; keyframes: PropertyIndexedKeyframes }[] = [];
    let finish = () => {};
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
    HTMLElement.prototype.animate = function (this: HTMLElement, keyframes: Keyframe[] | PropertyIndexedKeyframes | null) {
      calls.push({ node: this, keyframes: keyframes as PropertyIndexedKeyframes });
      return { cancel() {}, finished, playbackRate: 1 } as unknown as Animation;
    };
    return { margins: () => calls.filter((call) => 'marginInlineEnd' in call.keyframes), finish };
  };

  it('grows a new swatch in and folds a removed one away, which leaves once its spring settles', async () => {
    const motion = animate();
    render(<Owner initial={['#ff0000', '#00ff00']} />);
    expect(motion.margins()).toHaveLength(0);
    fireEvent.click(addButton()!);
    expect(motion.margins()).toHaveLength(1);
    expect(motion.margins()[0]!.keyframes.marginInlineEnd).toEqual([expect.stringMatching(/^-?\d/), '0px']);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(removeButtons()[0]!);
    expect(motion.margins()).toHaveLength(2);
    // The folding copy stays out of the accessibility tree and the roving order.
    const ghost = group().querySelector('[data-leaving]')!;
    expect(ghost).toHaveAttribute('aria-hidden', 'true');
    expect(swatches()).toHaveLength(2);
    await act(async () => { motion.finish(); await Promise.resolve(); });
    expect(group().querySelector('[data-leaving]')).toBeNull();
  });

  it('adds and removes instantly inside a data-reduced-motion ancestor', () => {
    const motion = animate();
    render(<div data-reduced-motion=""><Owner initial={['#ff0000', '#00ff00']} /></div>);
    fireEvent.click(addButton()!);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(removeButtons()[0]!);
    expect(motion.margins()).toHaveLength(0);
    expect(group().querySelector('[data-leaving]')).toBeNull();
  });

  it('adds and removes instantly under the system’s reduced motion', () => {
    const motion = animate();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
    render(<Owner initial={['#ff0000', '#00ff00']} />);
    fireEvent.click(addButton()!);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(removeButtons()[0]!);
    expect(motion.margins()).toHaveLength(0);
  });
});
