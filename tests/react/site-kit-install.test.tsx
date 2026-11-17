import { act, fireEvent, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallSection } from '../../apps/site/src/components/kit/install-section';
import { StarSection } from '../../apps/site/src/components/kit/star-section';
import { GITHUB_URL, registryCommand, registryUrlCommand } from '../../apps/site/src/lib/site';

const page = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock('../../apps/site/src/components/site/notifications', async (original) => ({
  ...(await original<typeof import('../../apps/site/src/components/site/notifications')>()),
  usePageNotifications: () => page,
}));

let reduced = false;
beforeEach(() => {
  page.show.mockReset();
  reduced = false;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') ? reduced : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const section = () => {
  const view = render(<InstallSection />);
  const byLabel = (label: string | RegExp) =>
    [...view.container.querySelectorAll<HTMLElement>('button, input')].find((element) => {
      const name = element.getAttribute('aria-label') ?? element.textContent ?? '';
      return typeof label === 'string' ? name === label : label.test(name);
    })!;
  return { ...view, byLabel, active: () => view.container.querySelector<HTMLElement>('.ki-snippet[data-active]')! };
};

describe('the install section on the kit landing', () => {
  it('runs nothing by itself', () => {
    section();
    expect(page.show).not.toHaveBeenCalled();
  });

  it('Run and Enter in the title send the notification the code shows (no flight under reduced motion)', () => {
    reduced = true;
    const view = section();
    const title = view.byLabel(/Notification title/) as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'Deployed' } });
    act(() => view.byLabel('Kind: success. Change').click());
    // The title is an input in the code; the kind a button that cycles.
    expect(title.value).toBe('Deployed');
    expect(view.active().textContent).toContain('controller.show({ title: "", kind: "info" });');
    act(() => view.byLabel('Run').click());
    expect(page.show).toHaveBeenLastCalledWith({ title: 'Deployed', kind: 'info' });
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(page.show).toHaveBeenCalledTimes(2);
  });

  it('follows the switch: the command, the address and the code of the chosen component', () => {
    const view = section();
    const text = () => view.container.textContent ?? '';
    expect(view.byLabel(`Copy command: ${registryCommand('toaster')}`)).toBeDefined();
    expect(view.byLabel(`Copy command: ${registryUrlCommand('toaster')}`)).toBeDefined();
    expect(text()).toContain('@cloudlet/toast from npm');
    act(() => view.byLabel('Color palette').click());
    expect(view.byLabel(`Copy command: ${registryUrlCommand('color-palette')}`)).toBeDefined();
    expect(view.active().textContent).toContain('<ColorPalette colors={colors} onChange={setColors} />');
    expect(view.active().querySelector('.color-palette')).not.toBeNull();
    // The others stay in place for the height, out of reach.
    const hidden = [...view.container.querySelectorAll<HTMLElement>('.ki-snippet:not([data-active])')];
    expect(hidden).toHaveLength(2);
    for (const snippet of hidden) expect(snippet.hasAttribute('inert')).toBe(true);
    act(() => view.byLabel('Color picker').click());
    expect(view.active().querySelector('.color-picker')).not.toBeNull();
  });
});

describe('the Star section', () => {
  it('links to the repository, with the count only from 100 stars, and gives the command once more', () => {
    const few = renderToStaticMarkup(<StarSection stars={42} />);
    expect(few).toContain(`href="${GITHUB_URL}"`);
    expect(few).toContain('aria-label="Star on GitHub"');
    expect(few).not.toContain('ks-star-number');
    expect(few).toContain(`Copy command: ${registryCommand('toaster')}`);
    const many = renderToStaticMarkup(<StarSection stars={1234} />);
    expect(many).toContain('aria-label="Star on GitHub, 1.2k stars"');
    expect(many).toContain('>1.2k<');
  });
});
