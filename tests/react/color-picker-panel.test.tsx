import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorPicker, ColorPickerPanel, type ColorFormat } from '@/components/ui/color-picker/color-picker';

const LABELS = { open: 'Pick color', panel: 'Color picker' };

function Owner({ initial = '#00ff00', format, formats, alpha = false, onChange = () => {}, onFormatChange }: {
  initial?: string;
  format?: ColorFormat;
  formats?: readonly ColorFormat[];
  alpha?: boolean;
  onChange?: (value: string) => void;
  onFormatChange?: (format: ColorFormat) => void;
}) {
  const [color, setColor] = useState(initial);
  return (
    <ColorPicker
      color={color}
      alpha={alpha}
      labels={LABELS}
      {...(format ? { format } : {})}
      {...(formats ? { formats } : {})}
      {...(onFormatChange ? { onFormatChange } : {})}
      onChange={(value) => { setColor(value); onChange(value); }}
    />
  );
}

const open = () => {
  fireEvent.click(screen.getByRole('button', { name: LABELS.open }));
  return screen.getByRole('dialog', { name: LABELS.panel });
};
const field = (scope: HTMLElement) => within(scope).getByRole('textbox', { name: 'Color value' });
const formatRadio = (scope: HTMLElement, name: string) => within(within(scope).getByRole('group', { name: 'Format' })).getByRole('radio', { name });

afterEach(() => {
  vi.useRealTimers();
  delete (window as { EyeDropper?: unknown }).EyeDropper;
});

describe('value field', () => {
  it('applies every parsable keystroke at once and keeps the draft as typed until blur', () => {
    const onChange = vi.fn();
    render(<Owner onChange={onChange} />);
    const dialog = open();
    const input = field(dialog);
    fireEvent.change(input, { target: { value: '#f' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('#f');
    fireEvent.change(input, { target: { value: '#f00' } });
    expect(onChange).toHaveBeenLastCalledWith('#ff0000');
    expect(input).toHaveValue('#f00');
    fireEvent.blur(input);
    expect(input).toHaveValue('#ff0000');
  });

  it('reads any syntax into the current format and puts an unparsable draft back on Enter', () => {
    const onChange = vi.fn();
    render(<Owner onChange={onChange} />);
    const dialog = open();
    const input = field(dialog);
    fireEvent.change(input, { target: { value: 'rgb(51 102 153)' } });
    expect(onChange).toHaveBeenLastCalledWith('#336699');
    fireEvent.change(input, { target: { value: 'not a color' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('#336699');
  });

  it('first Escape puts the draft back and keeps the focus, second Escape closes the panel', () => {
    render(<Owner />);
    const dialog = open();
    const input = field(dialog);
    input.focus();
    fireEvent.change(input, { target: { value: '#12' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('#00ff00');
    expect(input).toHaveFocus();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: LABELS.open })).toHaveFocus();
  });
});

describe('format switch', () => {
  it('offers the four formats, re-emits the same color in the new one and reports the switch', () => {
    const onChange = vi.fn();
    const onFormatChange = vi.fn();
    render(<Owner onChange={onChange} onFormatChange={onFormatChange} />);
    const dialog = open();
    expect(within(dialog).getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual(['hex', 'rgb', 'hsl', 'oklch']);
    expect(formatRadio(dialog, 'hex')).toBeChecked();
    fireEvent.click(formatRadio(dialog, 'rgb'));
    expect(onFormatChange).toHaveBeenCalledWith('rgb');
    expect(onChange).toHaveBeenLastCalledWith('rgb(0 255 0)');
    expect(field(dialog)).toHaveValue('rgb(0 255 0)');
    fireEvent.click(formatRadio(dialog, 'oklch'));
    expect(field(dialog)).toHaveValue('oklch(86.6% 0.295 142.5)');
    fireEvent.keyDown(within(dialog).getByRole('slider', { name: 'Hue' }), { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('oklch(62.8% 0.258 29.2)');
  });

  it('follows a controlled format and hides itself when only one format is offered', () => {
    const onFormatChange = vi.fn();
    const { unmount } = render(<Owner format="hsl" onFormatChange={onFormatChange} />);
    let dialog = open();
    expect(field(dialog)).toHaveValue('hsl(120 100% 50%)');
    fireEvent.click(formatRadio(dialog, 'hex'));
    expect(onFormatChange).toHaveBeenCalledWith('hex');
    expect(field(dialog)).toHaveValue('hsl(120 100% 50%)');
    unmount();
    render(<Owner formats={['hex']} />);
    dialog = open();
    expect(within(dialog).queryByRole('group', { name: 'Format' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument();
  });

  it('starts on defaultFormat and limits the switch to the formats given', () => {
    render(<ColorPickerPanel defaultColor="#ff8000" formats={['oklch', 'hex']} defaultFormat="oklch" />);
    const panel = screen.getByRole('textbox', { name: 'Color value' }).closest('.color-picker-panel') as HTMLElement;
    expect(field(panel)).toHaveValue('oklch(73.2% 0.186 53)');
    expect(within(panel).getAllByRole('radio')).toHaveLength(2);
  });
});

describe('uncontrolled and forms', () => {
  it('owns its value from defaultColor and keeps a hidden input in step, open or closed', () => {
    const { container } = render(<ColorPicker defaultColor="#336699" name="accent" labels={LABELS} />);
    const hidden = () => container.querySelector<HTMLInputElement>('input[type="hidden"][name="accent"]');
    expect(hidden()).toHaveValue('#336699');
    const dialog = open();
    expect(hidden()).toHaveValue('#336699');
    fireEvent.keyDown(within(dialog).getByRole('slider', { name: 'Hue' }), { key: 'End' });
    expect(field(dialog)).toHaveValue('#993333');
    expect(hidden()).toHaveValue('#993333');
    fireEvent.click(formatRadio(dialog, 'rgb'));
    expect(hidden()).toHaveValue('rgb(153 51 51)');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(hidden()).toHaveValue('rgb(153 51 51)');
  });

  it('renders ColorPickerPanel in the flow without a dialog, with every control and the hidden input', () => {
    const onChange = vi.fn();
    const { container } = render(<ColorPickerPanel defaultColor="#ff0000" name="tint" alpha onChange={onChange} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: LABELS.open })).not.toBeInTheDocument();
    for (const name of ['Saturation and brightness', 'Hue', 'Opacity']) expect(screen.getByRole('slider', { name })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Format' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Opacity' }), { key: 'ArrowLeft', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith('#ff0000e6');
    expect(container.querySelector('input[name="tint"]')).toHaveValue('#ff0000e6');
  });

  it('takes label overrides and falls back to English for the rest', () => {
    render(<ColorPickerPanel defaultColor="#000" labels={{ copy: 'Копировать', value: 'Значение' }} />);
    expect(screen.getByRole('button', { name: 'Копировать' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Значение' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Hue' })).toBeInTheDocument();
  });
});

describe('tools', () => {
  it('hides the eyedropper where the API is missing and applies its pick where it exists', async () => {
    const onChange = vi.fn();
    const { unmount } = render(<Owner onChange={onChange} />);
    open();
    expect(screen.queryByRole('button', { name: 'Pick from screen' })).not.toBeInTheDocument();
    unmount();
    (window as { EyeDropper?: unknown }).EyeDropper = class { open() { return Promise.resolve({ sRGBHex: '#123456' }); } };
    render(<Owner onChange={onChange} />);
    open();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pick from screen' }));
    });
    expect(onChange).toHaveBeenLastCalledWith('#123456');
  });

  it('leaves the color alone when the eyedropper is dismissed', async () => {
    const onChange = vi.fn();
    (window as { EyeDropper?: unknown }).EyeDropper = class { open() { return Promise.reject(new DOMException('aborted', 'AbortError')); } };
    render(<Owner onChange={onChange} />);
    open();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pick from screen' }));
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('copies the value in the current format, says so politely for a moment, and stays quiet when the clipboard refuses', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Owner />);
    const dialog = open();
    fireEvent.click(formatRadio(dialog, 'hsl'));
    const copy = within(dialog).getByRole('button', { name: 'Copy' });
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(writeText).toHaveBeenCalledWith('hsl(120 100% 50%)');
    const live = dialog.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent('Copied');
    expect(copy).toHaveAttribute('data-copied', 'true');
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(live).toHaveTextContent('');
    expect(copy).not.toHaveAttribute('data-copied');
    writeText.mockImplementationOnce(() => Promise.reject(new Error('denied')));
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(live).toHaveTextContent('');
  });
});
