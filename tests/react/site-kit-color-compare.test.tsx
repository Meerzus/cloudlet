import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COLOR_CHIPS, COLOR_SIDES } from '../../apps/site/src/components/kit/color-compare';
import { PickerChapter } from '../../apps/site/src/components/kit/picker-chapter';
import { SETTLE } from '../../apps/site/src/lib/color-report';
import { harmoniesOf } from '../../apps/site/src/lib/harmonies';

const page = vi.hoisted(() => ({
  show: vi.fn(),
  update: vi.fn(),
  getHandle: vi.fn(),
}));
vi.mock('../../apps/site/src/components/picker/section-paint', () => ({ mountSectionPaint: () => ({ show() {}, destroy() {} }) }));
vi.mock('../../apps/site/src/components/site/notifications', async (original) => ({
  ...(await original<typeof import('../../apps/site/src/components/site/notifications')>()),
  usePageNotifications: () => page,
}));

beforeEach(() => {
  vi.useFakeTimers();
  page.show.mockReset();
  page.update.mockReset();
  page.getHandle.mockReset();
  const live = new Set<string>();
  page.show.mockImplementation((spec: { id: string }) => {
    live.add(spec.id);
    return { status: 'created', handle: { id: spec.id } };
  });
  page.update.mockReturnValue({ status: 'applied' });
  page.getHandle.mockImplementation((id: string) => (live.has(id) ? { id } : undefined));
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  window.history.replaceState(null, '', '/?c=ff6a3d');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const chapter = () => {
  const view = render(<PickerChapter />);
  const sides = (side: 'plain' | 'cloudlet') => view.container.querySelectorAll<HTMLElement>(`.kc-side[data-side='${side}']`);
  return {
    ...view,
    nativeAccent: () => view.container.querySelector<HTMLInputElement>('#kc-native-accent')!,
    kitAccent: () => sides('cloudlet')[0]!.querySelector('.kc-value')!.textContent,
    plainColors: () => [...sides('plain')[1]!.querySelectorAll<HTMLInputElement>('input[type="color"]')].map((input) => input.value),
    kitColors: () => sides('cloudlet')[1]!.querySelectorAll('.color-palette-item').length,
    button: (name: string) => [...view.container.querySelectorAll('button')].find((button) => (button.getAttribute('aria-label') ?? button.textContent) === name)!,
  };
};

describe('the color picker chapter on the kit landing', () => {
  it('reports nothing on load', () => {
    chapter();
    act(() => vi.advanceTimersByTime(SETTLE * 10));
    expect(page.show).not.toHaveBeenCalled();
  });

  it('one press sets both sides, and the Island reports it once it has settled', () => {
    const view = chapter();
    act(() => view.button(COLOR_CHIPS[2]).click());
    expect(view.nativeAccent().value).toBe(COLOR_CHIPS[2]);
    expect(view.kitAccent()).toBe(COLOR_CHIPS[2]);
    act(() => vi.advanceTimersByTime(SETTLE - 1));
    expect(page.show).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(page.show).toHaveBeenCalledWith(expect.objectContaining({ title: 'Accent updated', description: { kind: 'text', text: 'The chapter now paints in #7CC6FE.' } }));
    // The next change while it is on screen updates it.
    act(() => view.button(COLOR_CHIPS[4]).click());
    act(() => vi.advanceTimersByTime(SETTLE));
    expect(page.show).toHaveBeenCalledTimes(1);
    expect(page.update).toHaveBeenLastCalledWith({ id: 'kit-color-1' }, expect.objectContaining({ title: 'Accent updated' }));
  });

  it('a change on the browser’s side shows on the kit’s, and the same color again is not reported', () => {
    const view = chapter();
    act(() => fireEvent.change(view.nativeAccent(), { target: { value: '#2e8b57' } }));
    expect(view.kitAccent()).toBe('#2e8b57');
    act(() => vi.advanceTimersByTime(SETTLE));
    expect(page.show).toHaveBeenCalledTimes(1);
    act(() => view.button('#2e8b57').click());
    act(() => vi.advanceTimersByTime(SETTLE));
    expect(page.show).toHaveBeenCalledTimes(1);
    expect(page.update).not.toHaveBeenCalled();
  });

  it('a harmony fills both palettes; the plain row adds and removes, and the kit’s follows', () => {
    const view = chapter();
    const tints = harmoniesOf('#ff6a3d').find((harmony) => harmony.id === 'tints')!;
    act(() => view.button('Tints').click());
    expect(view.plainColors()).toEqual(tints.colors);
    expect(view.kitColors()).toBe(4);
    expect(view.container.querySelector('.kc-plain-add')).toBeNull();
    act(() => vi.advanceTimersByTime(SETTLE));
    expect(page.show).toHaveBeenCalledWith(expect.objectContaining({ title: 'Palette updated' }));
    act(() => view.button('Remove color 2').click());
    expect(view.plainColors()).toEqual([tints.colors[0], tints.colors[2], tints.colors[3]]);
    expect(view.kitColors()).toBe(3);
    // The usual plus repeats the last color.
    act(() => view.button('Add color').click());
    expect(view.plainColors()).toEqual([tints.colors[0], tints.colors[2], tints.colors[3], tints.colors[3]]);
    expect(view.kitColors()).toBe(4);
    act(() => vi.advanceTimersByTime(SETTLE));
    expect(page.show).toHaveBeenCalledTimes(1);
    expect(page.update).toHaveBeenLastCalledWith({ id: 'kit-color-1' }, expect.objectContaining({ title: 'Palette updated' }));
  });

  it('links each comparison to its landing with its own command, and names no other library', () => {
    const view = chapter();
    const links = [...view.container.querySelectorAll('a')].map((link) => [link.textContent, link.getAttribute('href')]);
    expect(links).toEqual([
      ['Open Color picker', '/color-picker'],
      ['Open Color palette', '/color-picker#palette'],
    ]);
    const commands = [...view.container.querySelectorAll('.kit-install-command')].map((button) => button.getAttribute('aria-label'));
    expect(commands).toEqual(['Copy command: npx shadcn@latest add @cloudlet/color-picker', 'Copy command: npx shadcn@latest add @cloudlet/color-palette']);
    const words = Object.values(COLOR_SIDES).flatMap((side) => [side.label, side.note]).join(' ');
    expect(words).not.toMatch(/react-colorful|chrome|safari|firefox|radix|mui|ant/iu);
  });
});
