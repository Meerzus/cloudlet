import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PalettePreviewStage } from '../../apps/site/src/components/docs/palette-preview-stage';
import { PickerPreviewStage } from '../../apps/site/src/components/docs/picker-preview-stage';
import type { CodeTable } from '../../apps/site/src/lib/code-table';
import { codeTable } from '../../apps/site/src/lib/code-tokens';
import { paletteCode, paletteCodes, pickerCode, pickerCodes } from '../../apps/site/src/lib/picker-settings';

// jsdom has no ResizeObserver: the segmented control's sliding highlight re-measures on it.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

/**
 * The Previews of the color picker's and the color palette's pages: every control changes the live
 * component, the value its `onChange` gives and the code under the controls; the reader's own
 * choice of a format in the picker moves the Format control; Copy gives the code shown.
 */
const page = vi.hoisted(() => ({ copied: '' }));

vi.mock('@/components/site/notifications', () => ({
  useCopy: () => async (text: string) => {
    page.copied = text;
    return true;
  },
}));

let picker: CodeTable;
let palette: CodeTable;
beforeAll(async () => {
  picker = await codeTable(pickerCodes());
  palette = await codeTable(paletteCodes());
});
beforeEach(() => {
  page.copied = '';
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const code = () => document.querySelector('.docs-preview pre')?.textContent;
const value = (name: string) => screen.getByRole('status', { name }).textContent;
/** A control of the Preview; the picker has a Format switch of its own, so the search stays inside the settings. */
const radio = (group: string, option: string) =>
  within(within(screen.getByRole('group', { name: /settings$/u })).getByRole('group', { name: group })).getByRole('radio', { name: option });
const pick = (group: string, option: string) => fireEvent.click(radio(group, option));

describe('docs color picker preview', () => {
  it('starts as the swatch at the defaults, with the shortest code', () => {
    render(<PickerPreviewStage codes={picker} />);
    expect(screen.getByRole('group', { name: 'Color picker settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open the preview picker' })).toBeInTheDocument();
    expect(value('Value from onChange')).toBe('#245cdb');
    expect(code()).toBe(pickerCode({ kind: 'swatch', format: 'hex', alpha: false }));
    expect(document.querySelector('.docs-code-title')?.textContent).toBe('ColorPicker');
  });

  it('changes the component, the value and the code with every control', () => {
    render(<PickerPreviewStage codes={picker} />);
    pick('Component', 'Panel');
    expect(screen.queryByRole('button', { name: 'Open the preview picker' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Preview color value' })).toHaveValue('#245cdb');
    expect(code()).toBe(pickerCode({ kind: 'panel', format: 'hex', alpha: false }));
    expect(document.querySelector('.docs-code-title')?.textContent).toBe('ColorPickerPanel');

    pick('Format', 'rgb');
    expect(value('Value from onChange')).toBe('rgb(36 92 219)');
    expect(screen.getByRole('textbox', { name: 'Preview color value' })).toHaveValue('rgb(36 92 219)');
    expect(code()).toBe(pickerCode({ kind: 'panel', format: 'rgb', alpha: false }));

    expect(screen.queryByRole('slider', { name: 'Opacity' })).toBeNull();
    pick('Opacity', 'On');
    const opacity = screen.getByRole('slider', { name: 'Opacity' });
    expect(code()).toBe(pickerCode({ kind: 'panel', format: 'rgb', alpha: true }));
    // Half opacity from the keyboard reaches the value; turning Opacity off drops it again.
    fireEvent.keyDown(opacity, { key: 'ArrowLeft', shiftKey: true });
    expect(value('Value from onChange')).toBe('rgb(36 92 219 / 0.9)');
    pick('Opacity', 'Off');
    expect(value('Value from onChange')).toBe('rgb(36 92 219)');
    expect(screen.queryByRole('slider', { name: 'Opacity' })).toBeNull();

    pick('Component', 'Swatch');
    expect(screen.getByRole('button', { name: 'Open the preview picker' })).toBeInTheDocument();
    expect(value('Value from onChange')).toBe('rgb(36 92 219)');
    expect(code()).toBe(pickerCode({ kind: 'swatch', format: 'rgb', alpha: false }));
  });

  it('follows the format the reader picks in the picker itself', () => {
    render(<PickerPreviewStage codes={picker} />);
    pick('Component', 'Panel');
    const own = document.querySelector<HTMLElement>('.color-picker-formats')!;
    fireEvent.click(within(own).getByRole('radio', { name: 'hsl' }));
    expect(radio('Format', 'hsl')).toBeChecked();
    expect(value('Value from onChange')).toMatch(/^hsl\(/u);
    expect(code()).toBe(pickerCode({ kind: 'panel', format: 'hsl', alpha: false }));
  });

  it('copies the code it shows', async () => {
    render(<PickerPreviewStage codes={picker} />);
    pick('Format', 'oklch');
    fireEvent.click(screen.getByRole('button', { name: 'Copy ColorPicker' }));
    await act(async () => {});
    expect(page.copied).toBe(pickerCode({ kind: 'swatch', format: 'oklch', alpha: false }));
    expect(screen.getByRole('button', { name: 'Copied ColorPicker' })).toBeInTheDocument();
  });
});

describe('docs color palette preview', () => {
  const swatches = () => screen.getAllByRole('button', { name: /^Color \d of \d/u });

  it('starts with three colors of four, and the shortest code', () => {
    render(<PalettePreviewStage codes={palette} />);
    expect(screen.getByRole('group', { name: 'Color palette settings' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Preview palette' })).toBeInTheDocument();
    expect(swatches()).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Add color' })).toBeInTheDocument();
    expect(value('Colors from onChange')).toBe('["#245cdb", "#f2b84b", "#2f8f9d"]');
    expect(code()).toBe(paletteCode({ max: '4', format: 'hex', alpha: false }));
  });

  it('changes the palette, the array and the code with every control', () => {
    render(<PalettePreviewStage codes={palette} />);
    pick('Max', '3');
    expect(swatches()).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Add color' })).toBeNull();
    expect(code()).toBe(paletteCode({ max: '3', format: 'hex', alpha: false }));

    // A Max below the number of colors drops the last one; the control keeps the focus.
    radio('Max', '2').focus();
    pick('Max', '2');
    expect(swatches()).toHaveLength(2);
    expect(value('Colors from onChange')).toBe('["#245cdb", "#f2b84b"]');
    expect(radio('Max', '2')).toHaveFocus();
    expect(code()).toBe(paletteCode({ max: '2', format: 'hex', alpha: false }));

    pick('Format', 'rgb');
    expect(value('Colors from onChange')).toBe('["rgb(36 92 219)", "rgb(242 184 75)"]');
    expect(code()).toBe(paletteCode({ max: '2', format: 'rgb', alpha: false }));

    pick('Opacity', 'On');
    expect(code()).toBe(paletteCode({ max: '2', format: 'rgb', alpha: true }));

    pick('Max', '4');
    expect(swatches()).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Add color' })).toBeInTheDocument();
  });

  it('copies the code it shows', async () => {
    render(<PalettePreviewStage codes={palette} />);
    pick('Max', '3');
    fireEvent.click(screen.getByRole('button', { name: 'Copy ColorPalette' }));
    await act(async () => {});
    expect(page.copied).toBe(paletteCode({ max: '3', format: 'hex', alpha: false }));
  });
});
