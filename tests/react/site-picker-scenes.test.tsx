import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Combinations } from '../../apps/site/src/components/picker/combinations';
import { Keyboards } from '../../apps/site/src/components/picker/keyboards';
import { PickerColorProvider } from '../../apps/site/src/components/picker/picker-color';
import { START_GLOBAL } from '../../apps/site/src/lib/landscape';

const copied = vi.hoisted(() => ({ text: '' }));
vi.mock('@/components/site/notifications', () => ({
  useCopy: () => async (text: string) => {
    copied.text = text;
    return true;
  },
}));

const root = document.documentElement;
const global = window as unknown as Record<string, unknown>;

beforeEach(() => {
  global[START_GLOBAL] = '#ff6a3d';
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete global[START_GLOBAL];
  root.removeAttribute('data-cp-hour');
  root.style.removeProperty('--cp-color');
  window.history.replaceState(null, '', '/');
});

describe('color picker landing scenes (COLOR_PICKER §8.5)', () => {
  it('Combinations copies a harmony in the format chosen above it', async () => {
    render(<PickerColorProvider><Combinations /></PickerColorProvider>);
    const complement = within(screen.getByRole('heading', { name: 'Complement' }).parentElement!);
    fireEvent.click(complement.getByRole('button', { name: 'Copy #ff6a3d' }));
    await act(async () => {});
    expect(copied.text).toBe('#ff6a3d');
    fireEvent.click(screen.getByRole('radio', { name: 'oklch' }));
    const value = complement.getAllByRole('button')[0]!.textContent!;
    expect(value).toMatch(/^oklch\(/);
    fireEvent.click(complement.getAllByRole('button')[0]!);
    await act(async () => {});
    expect(copied.text).toBe(value);
    // Three posters, each captioned with its harmony.
    expect(screen.getAllByRole('figure')).toHaveLength(3);
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
