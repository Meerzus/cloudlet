import { act, fireEvent, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HERO_TOASTS, UPLOAD_MS } from '../../apps/site/src/components/kit/hero-parts';
import { KitColor, KIT_START_COLOR } from '../../apps/site/src/components/kit/kit-color';
import { BROWSE_HREF, KitHero } from '../../apps/site/src/components/kit/kit-hero';
import { SETTLE } from '../../apps/site/src/lib/color-report';
import { COMPONENTS } from '../../apps/site/src/lib/site';

const page = vi.hoisted(() => ({ show: vi.fn(), update: vi.fn(), getHandle: vi.fn(), track: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));
vi.mock('../../apps/site/src/components/picker/section-paint', () => ({ mountSectionPaint: () => ({ show() {}, destroy() {} }) }));
vi.mock('../../apps/site/src/components/site/notifications', async (original) => ({
  ...(await original<typeof import('../../apps/site/src/components/site/notifications')>()),
  usePageNotifications: () => page,
}));

/** The system asks for reduced motion: Send skips the flight and sends at once. */
let reduced = true;

beforeEach(() => {
  vi.useFakeTimers();
  reduced = true;
  for (const mock of Object.values(page)) mock.mockReset();
  page.show.mockImplementation((spec: { id?: string }) => ({ status: 'created', handle: { id: spec.id ?? 'n' } }));
  page.getHandle.mockReturnValue(undefined);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') && reduced, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const hero = () =>
  render(
    <KitColor>
      <KitHero />
    </KitColor>,
  );
const button = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll('button')].find((element) => (element.getAttribute('aria-label') ?? element.textContent) === name)!;

describe('the kit hero', () => {
  it('renders on the server: the words, the command, two buttons, then Toaster, picker and palette, in the start color', () => {
    const html = renderToStaticMarkup(
      <KitColor>
        <KitHero />
      </KitColor>,
    );
    expect(html).toContain('id="hero"');
    expect(html).toContain('Made to work <span>together.</span>');
    expect(html).toContain('Change one color and the whole kit answers.');
    expect(html).toContain('npx shadcn@latest add');
    expect(html).toContain(`href="${BROWSE_HREF}"`);
    expect(BROWSE_HREF).toBe('/docs#components');
    expect(html).toContain('Browse components');
    expect(html).toContain('href="https://github.com/');
    expect(html).toContain(`--paint-color:${KIT_START_COLOR}`);
    // The sky hero is gone: no wordmark, no islands.
    expect(html).not.toContain('wordmark');
    expect(html).not.toContain('kit-island');
    const parts = [...html.matchAll(/data-part="([^"]+)"/g)].map((match) => match[1]);
    expect(parts).toEqual(['toaster', 'color-picker', 'color-palette']);
    // Every component of the kit is in the hero.
    expect(parts).toEqual(COMPONENTS.map((component) => component.id));
  });

  it('says nothing on load', () => {
    hero();
    act(() => vi.advanceTimersByTime(SETTLE * 10));
    expect(page.show).not.toHaveBeenCalled();
    expect(page.track).not.toHaveBeenCalled();
  });

  it('Send puts the kind shown in the record into the Island; the record follows the chosen kind', () => {
    const { container } = hero();
    const record = container.querySelector<HTMLElement>('.kh-toast')!;
    expect(record.dataset.kind).toBe('success');
    fireEvent.click(container.querySelector('.kh-send')!);
    expect(page.show).toHaveBeenLastCalledWith({ title: 'Synced to the cloud', kind: 'success', description: { kind: 'text', text: 'Every change is saved.' } });
    fireEvent.click(button(container, 'Error'));
    expect(record.dataset.kind).toBe('error');
    expect(record.textContent).toContain('Upload drifted off');
    expect(button(container, 'Error').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(container.querySelector('.kh-send')!);
    expect(page.show).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Upload drifted off', kind: 'error' }));
  });

  it('Loading is tracked: pending, then a success in place', async () => {
    const { container } = hero();
    fireEvent.click(button(container, 'Loading'));
    fireEvent.click(container.querySelector('.kh-send')!);
    expect(page.track).toHaveBeenCalledTimes(1);
    const [source, options] = page.track.mock.calls[0]!;
    const loading = HERO_TOASTS.find((toast) => toast.kind === 'loading')!;
    expect(options.pending.title).toBe(loading.title);
    expect(options.success.title).toBe(loading.done!.title);
    let settled = false;
    void (source as Promise<void>).then(() => (settled = true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPLOAD_MS);
    });
    expect(settled).toBe(true);
  });

  it('with motion on, the notification flies out of the record and lands in the Island', () => {
    reduced = false;
    const animate = vi.fn(() => ({ finished: new Promise(() => {}) }));
    HTMLElement.prototype.animate = animate as unknown as HTMLElement['animate'];
    const { container } = hero();
    fireEvent.click(container.querySelector('.kh-send')!);
    expect(animate).toHaveBeenCalled();
    expect(document.querySelector('.ki-pill')?.textContent).toBe('Synced to the cloud');
    expect(page.show).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2000));
    expect(page.show).toHaveBeenCalledWith(expect.objectContaining({ title: 'Synced to the cloud' }));
    document.querySelector('.ki-pill')?.remove();
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  });

  it('a palette of the visitor’s own is reported once it settles, as one notification', () => {
    const { container } = hero();
    fireEvent.click(button(container, 'Add color'));
    expect(page.show).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(SETTLE));
    expect(page.show).toHaveBeenCalledTimes(1);
    expect(page.show.mock.calls[0]![0]).toMatchObject({ title: 'Palette updated', kind: 'success' });
  });
});
