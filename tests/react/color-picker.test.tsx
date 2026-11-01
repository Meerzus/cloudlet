import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ColorPicker } from '@/components/ui/color-picker/color-picker';

const LABELS = { open: 'Pick color', panel: 'Color picker', close: 'Close picker' };

/** A controlled owner, like the style editor: the picker sees what it last emitted. */
function Owner({ initial = '#00ff00', alpha = false, onChange = () => {} }: { initial?: string; alpha?: boolean; onChange?: (hex: string) => void }) {
  const [color, setColor] = useState(initial);
  return (
    <>
      <ColorPicker color={color} alpha={alpha} labels={LABELS} onChange={(hex) => { setColor(hex); onChange(hex); }} />
      <output data-testid="value">{color}</output>
      <button type="button" onClick={() => setColor('#336699')}>Set blue</button>
    </>
  );
}

const open = () => {
  fireEvent.click(screen.getByRole('button', { name: LABELS.open }));
  return screen.getByRole('dialog', { name: LABELS.panel });
};
const value = () => screen.getByTestId('value').textContent;
const area = (dialog: HTMLElement) => within(dialog).getByRole('slider', { name: 'Saturation and brightness' });
const hue = (dialog: HTMLElement) => within(dialog).getByRole('slider', { name: 'Hue' });

/** Gives an element a layout box so pointer positions mean something in jsdom. */
const box = (element: HTMLElement, width: number, height: number) => {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect);
};

describe('ColorPicker', () => {
  it('opens from the swatch into a dialog, focuses the area and names the sliders with their values', () => {
    render(<Owner />);
    const swatch = screen.getByRole('button', { name: LABELS.open });
    expect(swatch).toHaveAttribute('aria-expanded', 'false');
    const dialog = open();
    expect(swatch).toHaveAttribute('aria-expanded', 'true');
    expect(swatch).toHaveAttribute('aria-controls', dialog.id);
    expect(area(dialog)).toHaveFocus();
    expect(area(dialog)).toHaveAttribute('aria-valuetext', 'Saturation 100%, Brightness 100%');
    expect(hue(dialog)).toHaveAttribute('aria-valuenow', '120');
    expect(hue(dialog)).toHaveAttribute('aria-valuetext', '120°');
    expect(within(dialog).queryByRole('slider', { name: 'Opacity' })).not.toBeInTheDocument();
    expect(within(dialog).getByText('#00ff00')).toBeInTheDocument();
  });

  it('moves saturation and brightness with the arrows, ten times further with Shift, and never past the edges', () => {
    const onChange = vi.fn();
    render(<Owner onChange={onChange} />);
    const dialog = open();
    fireEvent.keyDown(area(dialog), { key: 'ArrowDown' });
    expect(value()).toBe('#00fc00');
    fireEvent.keyDown(area(dialog), { key: 'ArrowDown', shiftKey: true });
    expect(value()).toBe('#00e300');
    expect(area(dialog)).toHaveAttribute('aria-valuetext', 'Saturation 100%, Brightness 89%');
    fireEvent.keyDown(area(dialog), { key: 'ArrowLeft', shiftKey: true });
    expect(area(dialog)).toHaveAttribute('aria-valuenow', '90');
    fireEvent.keyDown(area(dialog), { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(area(dialog), { key: 'ArrowRight' });
    expect(area(dialog)).toHaveAttribute('aria-valuenow', '100');
    fireEvent.keyDown(area(dialog), { key: 'ArrowUp', shiftKey: true });
    fireEvent.keyDown(area(dialog), { key: 'ArrowUp', shiftKey: true });
    expect(value()).toBe('#00ff00');
    expect(onChange).toHaveBeenCalledTimes(7);
    expect(onChange).toHaveBeenLastCalledWith('#00ff00');
  });

  it('turns the hue with the arrows and jumps to the ends with Home and End', () => {
    render(<Owner />);
    const dialog = open();
    fireEvent.keyDown(hue(dialog), { key: 'ArrowRight', shiftKey: true });
    expect(hue(dialog)).toHaveAttribute('aria-valuenow', '130');
    expect(value()).toBe('#00ff2a');
    fireEvent.keyDown(hue(dialog), { key: 'ArrowLeft' });
    expect(hue(dialog)).toHaveAttribute('aria-valuenow', '129');
    fireEvent.keyDown(hue(dialog), { key: 'End' });
    expect(hue(dialog)).toHaveAttribute('aria-valuenow', '360');
    expect(value()).toBe('#ff0000');
    fireEvent.keyDown(hue(dialog), { key: 'Home' });
    expect(hue(dialog)).toHaveAttribute('aria-valuenow', '0');
    expect(value()).toBe('#ff0000');
  });

  it('keeps the hue while the color passes through white, so turning back restores the green', () => {
    render(<Owner />);
    const dialog = open();
    fireEvent.keyDown(area(dialog), { key: 'ArrowLeft', shiftKey: true });
    for (let i = 0; i < 9; i += 1) fireEvent.keyDown(area(dialog), { key: 'ArrowLeft', shiftKey: true });
    expect(value()).toBe('#ffffff');
    expect(hue(dialog)).toHaveAttribute('aria-valuenow', '120');
    fireEvent.keyDown(area(dialog), { key: 'ArrowRight', shiftKey: true });
    expect(value()).toBe('#e5ffe5');
  });

  it('picks with the pointer: a press in the area and a drag along the hue pill', () => {
    render(<Owner />);
    const dialog = open();
    box(area(dialog), 200, 100);
    fireEvent.pointerDown(area(dialog), { button: 0, buttons: 1, pointerId: 1, clientX: 100, clientY: 50 });
    expect(area(dialog)).toHaveAttribute('aria-valuetext', 'Saturation 50%, Brightness 50%');
    expect(value()).toBe('#408040');
    box(hue(dialog), 360, 14);
    fireEvent.pointerDown(hue(dialog), { button: 0, buttons: 1, pointerId: 1, clientX: 0, clientY: 7 });
    fireEvent.pointerMove(hue(dialog), { buttons: 1, pointerId: 1, clientX: 240, clientY: 7 });
    expect(hue(dialog)).toHaveAttribute('aria-valuenow', '240');
    fireEvent.pointerMove(hue(dialog), { buttons: 0, pointerId: 1, clientX: 0, clientY: 7 });
    expect(hue(dialog)).toHaveAttribute('aria-valuenow', '240');
    expect(value()).toBe('#404080');
  });

  it('follows a new color from outside and reads any CSS syntax, emitting hex', () => {
    const onChange = vi.fn();
    render(<Owner initial="oklch(62.8% 0.258 29.2)" onChange={onChange} />);
    const dialog = open();
    // The oklch canon rounds: this red lands one step off pure red, with the hue just under 360°.
    expect(within(dialog).getByText('#ff0001')).toBeInTheDocument();
    expect(hue(dialog)).toHaveAttribute('aria-valuenow', '360');
    fireEvent.click(screen.getByRole('button', { name: 'Set blue' }));
    expect(within(dialog).getByText('#336699')).toBeInTheDocument();
    expect(hue(dialog)).toHaveAttribute('aria-valuenow', '210');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the last valid color when the prop stops parsing and paints the swatch with it', () => {
    const { rerender } = render(<ColorPicker color="#336699" labels={LABELS} onChange={() => {}} />);
    rerender(<ColorPicker color="var(--surface)" swatch="var(--surface)" labels={LABELS} onChange={() => {}} />);
    const dialog = open();
    expect(within(dialog).getByText('#336699')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: LABELS.open }).parentElement).toHaveStyle({ '--color-picker-swatch': 'var(--surface)' });
  });

  it('shows the opacity slider when asked and writes alpha into the hex only below 1', () => {
    render(<Owner initial="#ff000080" alpha />);
    const dialog = open();
    const opacity = within(dialog).getByRole('slider', { name: 'Opacity' });
    expect(opacity).toHaveAttribute('aria-valuenow', '0.5');
    expect(opacity).toHaveAttribute('aria-valuetext', '50%');
    fireEvent.keyDown(opacity, { key: 'ArrowRight', shiftKey: true });
    expect(value()).toBe('#ff00009a');
    fireEvent.keyDown(opacity, { key: 'End' });
    expect(value()).toBe('#ff0000');
    fireEvent.keyDown(opacity, { key: 'ArrowLeft' });
    expect(value()).toBe('#ff0000fc');
  });

  it('drops alpha from the input when the slider is off', () => {
    render(<Owner initial="#ff000080" />);
    open();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Hue' }), { key: 'ArrowRight' });
    expect(value()).toBe('#ff0400');
  });

  it('closes on Escape and from the inner swatch back to the trigger, and on a press outside without moving focus', () => {
    render(<Owner />);
    const swatch = screen.getByRole('button', { name: LABELS.open });
    let dialog = open();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(swatch).toHaveAttribute('aria-expanded', 'false');
    expect(swatch).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    dialog = open();
    fireEvent.click(within(dialog).getByRole('button', { name: LABELS.close }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(swatch).toHaveFocus();
    dialog = open();
    const elsewhere = screen.getByRole('button', { name: 'Set blue' });
    elsewhere.focus();
    fireEvent.pointerDown(elsewhere);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(elsewhere).toHaveFocus();
  });
});
