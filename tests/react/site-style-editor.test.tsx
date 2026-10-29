import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StyleEditor } from '../../apps/site/src/components/docs/style-editor/style-editor';

// Use the real adapter and controller, with the shared jsdom presentation mock from setup.
vi.mock('@cloudlet/toast', () => import('../../packages/toast/src/index.js'));

const clipboard = vi.hoisted(() => ({ text: '', options: null as { toast?: boolean } | null }));
vi.mock('@/components/site/notifications', () => ({
  useCopy: (options: { toast?: boolean }) => {
    clipboard.options = options;
    return async (text: string) => {
      clipboard.text = text;
      return true;
    };
  },
}));

// The editor follows the site theme; tests set it and re-render.
const site = vi.hoisted(() => ({ theme: 'light' as 'light' | 'dark' }));
vi.mock('@/components/site/theme', () => ({
  useTheme: () => ({ preference: site.theme, resolved: site.theme, setPreference: () => {} }),
}));

const frame = () => document.querySelector<HTMLIFrameElement>('iframe.docs-style-frame')!;
const stage = () => frame().contentDocument!;
const hosts = () => [...stage().querySelectorAll<HTMLElement>('.cloudlet-host')];
const pill = () => stage().querySelector<HTMLElement>('[data-zone="pill"] .cloudlet-host')!;
const island = () => stage().querySelector<HTMLElement>('[data-zone="island"] .cloudlet-host')!;
const code = () => document.querySelector('.docs-style-code pre')?.textContent ?? '';
const EMPTY = '/* Nothing changed yet */';

function previewRule(dark = false): CSSStyleRule {
  const selector = `html .cloudlet-host${dark ? '[data-theme="dark"]' : ''}`;
  const rules = [...stage().styleSheets].flatMap((sheet) => [...sheet.cssRules]);
  const rule = rules.find((candidate): candidate is CSSStyleRule => 'selectorText' in candidate && candidate.selectorText === selector);
  if (!rule) throw new Error(`Missing editor preview rule: ${selector}`);
  return rule;
}

const slider = (name: string) => screen.getByRole('slider', { name });
const setRadius = (value: string) => fireEvent.change(slider('Pill radius'), { target: { value } });

beforeEach(() => {
  window.history.replaceState(null, '', '/docs/styling');
  clipboard.text = '';
  clipboard.options = null;
  site.theme = 'light';
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('docs style editor', () => {
  it('hydrates the default static HTML before applying the URL without a mismatch', () => {
    window.history.replaceState(null, '', '/docs/styling?pill-radius=12px');
    const container = document.createElement('div');
    container.innerHTML = renderToString(<StyleEditor />);
    document.body.append(container);
    expect(within(container).getByRole('slider', { name: 'Pill radius' })).toHaveAttribute('aria-valuetext', 'Full');
    const onRecoverableError = vi.fn();
    render(<StyleEditor />, { container, hydrate: true, onRecoverableError });
    expect(slider('Pill radius')).toHaveValue('12');
    expect(onRecoverableError).not.toHaveBeenCalled();
  });

  it('restores the URL after mount in Strict Mode, editing the colors of the site theme', () => {
    site.theme = 'dark';
    window.history.replaceState({ docs: true }, '', '/docs/styling?pill-radius=12px&background=%23f4f1ea&background-dark=%2314110c&font-family=Georgia%2C%20serif#style-editor');
    render(<StrictMode><StyleEditor /></StrictMode>);
    expect(slider('Pill radius')).toHaveValue('12');
    expect(screen.getByRole('textbox', { name: 'Pill radius value' })).toHaveValue('12');
    expect(island()).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByText('Dark theme')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Background' })).toHaveValue('#14110c');
    expect(screen.getByRole('textbox', { name: 'Custom font family' })).toHaveValue('Georgia, serif');
    expect(previewRule().style.getPropertyValue('--cloudlet-pill-radius')).toBe('12px');
    expect(previewRule(true).style.getPropertyValue('--cloudlet-background')).toBe('#14110c');
  });

  it('switches the edited colors and both Toasters with the site theme', () => {
    window.history.replaceState(null, '', '/docs/styling?background=%23f4f1ea&background-dark=%2314110c');
    const view = render(<StyleEditor />);
    expect(screen.getByRole('textbox', { name: 'Background' })).toHaveValue('#f4f1ea');
    expect(hosts().map((host) => host.dataset.theme)).toEqual(['light', 'light']);
    site.theme = 'dark';
    view.rerender(<StyleEditor />);
    expect(screen.getByRole('textbox', { name: 'Background' })).toHaveValue('#14110c');
    expect(hosts().map((host) => host.dataset.theme)).toEqual(['dark', 'dark']);
    expect(stage().documentElement.style.colorScheme).toBe('dark');
  });

  it('discards invalid URL values and the retired theme, and preserves unknown parameters', () => {
    vi.useFakeTimers();
    window.history.replaceState({ docs: true }, '', '/docs/styling?foo=1&background=red%3Bcolor%3Awhite&pill-radius=oops&theme=dark#style-editor');
    render(<StyleEditor />);
    expect(code()).toBe(EMPTY);
    expect(screen.getByRole('textbox', { name: 'Background' })).toHaveValue('#ffffff');
    act(() => vi.advanceTimersByTime(150));
    expect(window.location.search).toBe('?foo=1&theme=dark');
    expect(window.location.hash).toBe('#style-editor');
  });

  it('shows exact CSS values beyond slider units or ranges without NaN, and lets them return to sliders', () => {
    window.history.replaceState(null, '', '/docs/styling?pill-radius=var(--radius%2C%2012px)&pill-height=4rem&font-size=24px');
    const error = vi.spyOn(console, 'error');
    render(<StyleEditor />);
    expect(screen.getByRole('textbox', { name: 'Pill radius' })).toHaveValue('var(--radius, 12px)');
    expect(screen.getByRole('textbox', { name: 'Pill height' })).toHaveValue('4rem');
    expect(screen.getByRole('textbox', { name: 'Font size' })).toHaveValue('24px');
    expect(previewRule().style.getPropertyValue('--cloudlet-pill-radius')).toBe('var(--radius, 12px)');
    expect(code()).toContain('--cloudlet-pill-height: 4rem;');
    const radius = screen.getByRole('textbox', { name: 'Pill radius' });
    fireEvent.change(radius, { target: { value: '12px; color: red' } });
    expect(radius).toHaveAttribute('aria-invalid', 'true');
    expect(code()).not.toContain('color: red');
    fireEvent.change(radius, { target: { value: '12px' } });
    expect(slider('Pill radius')).toHaveValue('12');
    expect(error).not.toHaveBeenCalled();
  });

  it('debounces replacements, preserves history state and removes parameters when defaults return', () => {
    vi.useFakeTimers();
    window.history.replaceState({ docs: true }, '', '/docs/styling?foo=1&foo=2#style-editor');
    const replace = vi.spyOn(window.history, 'replaceState');
    const push = vi.spyOn(window.history, 'pushState');
    render(<StyleEditor />);
    setRadius('12');
    act(() => vi.advanceTimersByTime(100));
    setRadius('16');
    act(() => vi.advanceTimersByTime(149));
    expect(replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(replace).toHaveBeenCalledExactlyOnceWith({ docs: true }, '', '/docs/styling?foo=1&foo=2&pill-radius=16px#style-editor');
    expect(push).not.toHaveBeenCalled();
    setRadius('33');
    act(() => vi.advanceTimersByTime(150));
    expect(window.location.search).toBe('?foo=1&foo=2');
  });

  it('flushes the pending URL before copying href and confirms without a toast', async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, '', '/docs/styling?foo=1#style-editor');
    render(<StyleEditor />);
    setRadius('12');
    expect(window.location.search).toBe('?foo=1');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    });
    expect(clipboard.options).toEqual({ toast: false });
    expect(clipboard.text).toBe(window.location.href);
    expect(clipboard.text).toContain('/docs/styling?foo=1&pill-radius=12px#style-editor');
    expect(screen.getByRole('button', { name: 'Copied link' })).toHaveTextContent('Copied');
    act(() => vi.advanceTimersByTime(1600));
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('clears editor query values immediately on Reset while keeping foreign values and the hash', () => {
    vi.useFakeTimers();
    window.history.replaceState({ docs: true }, '', '/docs/styling?foo=1&pill-radius=12px&background-dark=%2314110c#style-editor');
    const replace = vi.spyOn(window.history, 'replaceState');
    render(<StyleEditor />);
    setRadius('16');
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(replace).toHaveBeenCalledExactlyOnceWith({ docs: true }, '', '/docs/styling?foo=1#style-editor');
    expect(code()).toBe(EMPTY);
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
    act(() => vi.advanceTimersByTime(500));
    expect(window.location.search).toBe('?foo=1');
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('cancels pending URL replacements when unmounted', () => {
    vi.useFakeTimers();
    const replace = vi.spyOn(window.history, 'replaceState');
    const view = render(<StyleEditor />);
    setRadius('12');
    view.unmount();
    act(() => vi.advanceTimersByTime(500));
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows a pinned pill and an open Island in the stage frame, without buttons to trigger them', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const view = render(<StrictMode><StyleEditor /></StrictMode>);
    expect(hosts()).toHaveLength(2);
    expect(document.querySelectorAll('.cloudlet-host')).toHaveLength(0);
    expect(island()).toHaveAttribute('data-position', 'top-center');
    expect(island()).toHaveAttribute('aria-label', 'Style editor notifications');
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fire' })).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(600));
    expect(island()).toHaveAttribute('data-state', 'island');
    expect(within(island()).getByText('Your changes are safe on every device.')).toBeInTheDocument();
    expect(within(island()).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(pill()).toHaveAttribute('data-state', 'stack');
    expect(pill().closest('[data-zone]')).toHaveAttribute('inert');
    expect(island()).toHaveAttribute('data-state', 'island');

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('brings the Island back after it is closed', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    render(<StyleEditor />);
    act(() => vi.advanceTimersByTime(600));
    const close = within(island()).getAllByRole('button').find((button) => /close|dismiss/i.test(button.getAttribute('aria-label') ?? ''))!;
    fireEvent.click(close);
    act(() => vi.advanceTimersByTime(100));
    expect(within(island()).queryByText('Your changes are safe on every device.')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_500));
    expect(island()).toHaveAttribute('data-state', 'island');
    expect(within(island()).getByText('Your changes are safe on every device.')).toBeInTheDocument();
  });

  it('keeps the Island open while the controls are pressed: they live outside the stage document', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    render(<StyleEditor />);
    act(() => vi.advanceTimersByTime(600));
    fireEvent.pointerDown(slider('Island radius'));
    setRadius('12');
    expect(island()).toHaveAttribute('data-state', 'island');
  });

  it('applies the radius through CSSOM, marks the row changed and resets that row alone', () => {
    render(<StyleEditor />);
    setRadius('12');
    fireEvent.change(slider('Island radius'), { target: { value: '18' } });
    expect(previewRule().style.getPropertyValue('--cloudlet-pill-radius')).toBe('12px');
    expect(code()).toContain('--cloudlet-pill-radius: 12px;');
    expect(screen.getByRole('textbox', { name: 'Pill radius value' })).toHaveValue('12');
    expect(slider('Pill radius')).toHaveAttribute('aria-valuetext', '12px');
    expect(slider('Pill radius').closest('.docs-style-row')).toHaveAttribute('data-changed');

    fireEvent.click(screen.getByRole('button', { name: 'Reset Pill radius' }));
    expect(previewRule().style.getPropertyValue('--cloudlet-pill-radius')).toBe('');
    expect(slider('Pill radius')).toHaveAttribute('aria-valuetext', 'Full');
    expect(screen.getByRole('textbox', { name: 'Pill radius value' })).toHaveValue('Full');
    expect(code()).toBe('.cloudlet-host {\n  --cloudlet-island-radius: 18px;\n}');
  });

  it('accepts Full typed into the radius value', () => {
    window.history.replaceState(null, '', '/docs/styling?pill-radius=12px');
    render(<StyleEditor />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Pill radius value' }), { target: { value: 'full' } });
    expect(code()).toBe(EMPTY);
  });

  it('shares values between the typed value and the slider, and restores the rem font-size default', () => {
    render(<StyleEditor />);
    const value = screen.getByRole('textbox', { name: 'Font size value' });
    const range = slider('Font size');
    fireEvent.change(value, { target: { value: '16' } });
    expect(range).toHaveValue('16');
    expect(code()).toContain('--cloudlet-font-size: 16px;');
    fireEvent.change(value, { target: { value: '1' } });
    expect(value).toHaveAttribute('aria-invalid', 'true');
    expect(range).toHaveValue('16');
    fireEvent.change(range, { target: { value: '14' } });
    expect(value).toHaveValue('14');
    expect(code()).toBe(EMPTY);
    expect(previewRule().style.getPropertyValue('--cloudlet-font-size')).toBe('');
  });

  it('labels the dark block when dark colors change, keeping shape in the base rule', () => {
    site.theme = 'dark';
    render(<StyleEditor />);
    setRadius('12');
    fireEvent.change(screen.getByRole('textbox', { name: 'Background' }), { target: { value: '#14110c' } });
    expect(previewRule(true).style.getPropertyValue('--cloudlet-background')).toBe('#14110c');
    expect(code()).toBe([
      '/* Shape, type and light colors */',
      '.cloudlet-host {',
      '  --cloudlet-pill-radius: 12px;',
      '}',
      "/* Dark colors: they must beat the package's dark rule */",
      '.cloudlet-host[data-theme="dark"] {',
      '  --cloudlet-background: #14110c;',
      '}',
      '@media (prefers-color-scheme: dark) {',
      '  .cloudlet-host[data-theme="system"] {',
      '    --cloudlet-background: #14110c;',
      '  }',
      '}',
    ].join('\n'));

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(previewRule().style.getPropertyValue('--cloudlet-background')).toBe('');
    expect(previewRule(true).style.getPropertyValue('--cloudlet-background')).toBe('');
    expect(code()).toBe(EMPTY);
  });

  it('does not let a light surface override replace the default dark surface in the preview', () => {
    render(<StyleEditor />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Background' }), { target: { value: '#f4f1ea' } });
    expect(previewRule(true).style.getPropertyValue('--cloudlet-background')).toBe('#1c1c1e');
    expect(code()).toBe('.cloudlet-host {\n  --cloudlet-background: #f4f1ea;\n}');
    fireEvent.change(screen.getByRole('textbox', { name: 'Background' }), { target: { value: '#ffffff' } });
    expect(previewRule().style.getPropertyValue('--cloudlet-background')).toBe('');
    expect(previewRule(true).style.getPropertyValue('--cloudlet-background')).toBe('');
  });

  it('uses the loaded Inter font for the preview and exports its portable stack and loading note', () => {
    render(<StyleEditor />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Font' }), {
      target: { value: "'Inter', system-ui, sans-serif" },
    });
    expect(previewRule().style.getPropertyValue('--cloudlet-font-family')).toBe('var(--font-inter), system-ui, sans-serif');
    expect(code()).toBe([
      '/* load Inter in your app */',
      '.cloudlet-host {',
      "  --cloudlet-font-family: 'Inter', system-ui, sans-serif;",
      '}',
    ].join('\n'));
  });

  it('validates custom fonts before applying them and resets the custom field and its error', () => {
    render(<StyleEditor />);
    const select = screen.getByRole('combobox', { name: 'Font' });
    fireEvent.change(select, { target: { value: 'custom' } });
    const input = screen.getByRole('textbox', { name: 'Custom font family' });
    fireEvent.change(input, { target: { value: "'Atkinson Hyperlegible', sans-serif" } });
    expect(previewRule().style.getPropertyValue('--cloudlet-font-family')).toBe("'Atkinson Hyperlegible', sans-serif");
    expect(code()).toContain("--cloudlet-font-family: 'Atkinson Hyperlegible', sans-serif;");

    fireEvent.change(input, { target: { value: 'serif; --cloudlet-background: red' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(previewRule().style.getPropertyValue('--cloudlet-font-family')).toBe("'Atkinson Hyperlegible', sans-serif");
    expect(code()).not.toContain('--cloudlet-background');
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.queryByRole('textbox', { name: 'Custom font family' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Font' })).toHaveValue('system-ui, sans-serif');
    expect(previewRule().style.getPropertyValue('--cloudlet-font-family')).toBe('');
    expect(code()).toBe(EMPTY);
  });

  it('opens the picker from the swatch, picks with the keyboard and closes back to the swatch on Escape', () => {
    render(<StyleEditor />);
    const swatch = screen.getByRole('button', { name: 'Pick background color' });
    fireEvent.click(swatch);
    expect(swatch).toHaveAttribute('aria-expanded', 'true');
    const dialog = screen.getByRole('dialog', { name: 'Background color picker' });
    // White has no hue to turn: darken it in the saturation area (react-colorful reads keyCode).
    fireEvent.keyDown(within(dialog).getByRole('slider', { name: 'Color' }), { key: 'ArrowDown', keyCode: 40 });
    expect(screen.getByRole('textbox', { name: 'Background' })).not.toHaveValue('#ffffff');
    expect(code()).toContain('--cloudlet-background:');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(swatch).toHaveAttribute('aria-expanded', 'false');
    expect(swatch).toHaveFocus();
  });

  it('keeps the last valid hex in the picker when the text color becomes a CSS variable', () => {
    render(<StyleEditor />);
    const input = screen.getByRole('textbox', { name: 'Background' });
    fireEvent.change(input, { target: { value: '#336699' } });
    fireEvent.change(input, { target: { value: 'var(--surface)' } });
    expect(input).not.toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Pick background color' }));
    expect(within(screen.getByRole('dialog')).getByText('#336699')).toBeInTheDocument();
    expect(previewRule().style.getPropertyValue('--cloudlet-background')).toBe('var(--surface)');
    expect(code()).toContain('--cloudlet-background: var(--surface);');
  });

  it('keeps invalid text out of the preview and copied CSS, then recovers on valid input', () => {
    render(<StyleEditor />);
    const input = screen.getByRole('textbox', { name: 'Background' });
    fireEvent.change(input, { target: { value: '#f4f1ea' } });
    fireEvent.change(input, { target: { value: 'red; --cloudlet-foreground: white' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(previewRule().style.getPropertyValue('--cloudlet-background')).toBe('#f4f1ea');
    expect(code()).toContain('--cloudlet-background: #f4f1ea;');
    expect(code()).not.toContain('foreground');
    expect(code()).not.toContain('red;');

    fireEvent.change(input, { target: { value: '#ffffff' } });
    expect(input).not.toHaveAttribute('aria-invalid', 'true');
    expect(previewRule().style.getPropertyValue('--cloudlet-background')).toBe('');
    expect(code()).toBe(EMPTY);
  });

  it('copies only generated CSS and confirms in the button without a success toast', async () => {
    render(<StyleEditor />);
    expect(screen.getByRole('button', { name: 'Copy CSS' })).toBeDisabled();
    setRadius('12');
    const expected = code();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy CSS' }));
    });
    expect(clipboard.options).toEqual({ toast: false });
    expect(clipboard.text).toBe(expected);
    expect(clipboard.text).toContain('--cloudlet-pill-radius: 12px;');
    expect(screen.getByRole('button', { name: 'Copied CSS' })).toBeInTheDocument();
  });
});
