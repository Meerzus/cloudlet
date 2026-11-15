import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Header } from '../../apps/site/src/components/site/header';

const route = vi.hoisted(() => ({ pathname: '/toaster' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('@/components/site/theme-toggle', () => ({ ThemeToggle: () => null }));

// jsdom has no ResizeObserver (the edge blur and segment highlights re-measure on it) and no Web
// Animations API, so the panel opens and closes at once, as under reduced motion.
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  route.pathname = '/toaster';
});

const trigger = () => screen.getByRole('button', { name: 'Components' });
const panel = () => screen.queryByRole('navigation', { name: 'Components' });
const primary = () => within(screen.getByRole('navigation', { name: 'Primary' }));

describe('site header', () => {
  it('leads the logo to the kit and has no Playground link', () => {
    for (const pathname of ['/toaster', '/toaster/playground', '/color-picker', '/docs']) {
      route.pathname = pathname;
      const { unmount } = render(<Header />);
      expect(screen.getByRole('link', { name: 'Cloudlet' })).toHaveAttribute('href', '/');
      expect(screen.queryByRole('link', { name: 'Playground' })).toBeNull();
      unmount();
    }
  });

  it('leads Docs to the docs of the page’s component, or of the whole kit', () => {
    const cases = {
      '/toaster': '/docs/components/toaster',
      '/docs/components/toaster/styling': '/docs/components/toaster',
      '/color-picker': '/docs/components/color-picker',
      '/': '/docs',
      '/docs': '/docs',
      '/docs/installation': '/docs',
    };
    for (const [pathname, docs] of Object.entries(cases)) {
      route.pathname = pathname;
      const { unmount } = render(<Header />);
      expect(primary().getByRole('link', { name: 'Docs' })).toHaveAttribute('href', docs);
      unmount();
    }
  });
});

describe('Components panel', () => {
  it('opens and closes on the button, with aria-expanded and aria-controls', async () => {
    const user = userEvent.setup();
    render(<Header />);
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).not.toHaveAttribute('aria-controls');
    expect(panel()).toBeNull();

    await user.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(panel()).not.toBeNull();
    expect(trigger()).toHaveAttribute('aria-controls', panel()!.id);

    await user.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(panel()).toBeNull();
  });

  it('lists the three components with their addresses and marks the current one', async () => {
    const user = userEvent.setup();
    route.pathname = '/docs/components/color-picker';
    render(<Header />);
    await user.click(trigger());
    const links = within(panel()!).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/toaster', '/color-picker', '/color-picker#palette']);
    expect(within(panel()!).getByRole('link', { name: /^Color picker/ })).toHaveAttribute('aria-current', 'page');
    expect(within(panel()!).getByRole('link', { name: /^Toaster/ })).not.toHaveAttribute('aria-current');
    expect(within(panel()!).getByRole('link', { name: /^Color palette/ })).not.toHaveAttribute('aria-current');
    // Each item carries its line of description.
    expect(within(panel()!).getByRole('link', { name: /^Toaster/ })).toHaveTextContent('Notifications that stack softly');
  });

  it('marks no component on the kit’s own pages', async () => {
    const user = userEvent.setup();
    route.pathname = '/docs';
    render(<Header />);
    await user.click(trigger());
    for (const link of within(panel()!).getAllByRole('link')) expect(link).not.toHaveAttribute('aria-current');
  });

  it('closes on Escape and returns focus to the button', async () => {
    const user = userEvent.setup();
    render(<Header />);
    await user.click(trigger());
    await user.tab();
    expect(within(panel()!).getByRole('link', { name: /^Toaster/ })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(panel()).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('moves between the links with Tab and the arrow keys', async () => {
    const user = userEvent.setup();
    render(<Header />);
    await user.click(trigger());
    const [toaster, picker, palette] = within(panel()!).getAllByRole('link');
    await user.tab();
    expect(toaster).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(picker).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(palette).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(toaster).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(palette).toHaveFocus();
    await user.keyboard('{Home}');
    expect(toaster).toHaveFocus();
  });

  it('closes on a press outside', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Header />
        <p>Page</p>
      </>,
    );
    await user.click(trigger());
    await user.click(screen.getByText('Page'));
    expect(panel()).toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when focus leaves the panel', async () => {
    const user = userEvent.setup();
    render(<Header />);
    await user.click(trigger());
    await user.tab(); // Toaster
    await user.tab(); // Color picker
    await user.tab(); // Color palette
    await user.tab(); // Docs, outside the panel
    expect(primary().getByRole('link', { name: 'Docs' })).toHaveFocus();
    expect(panel()).toBeNull();
  });

  it('closes on a link, so a section of the same page closes it too', async () => {
    const user = userEvent.setup();
    route.pathname = '/color-picker';
    render(<Header />);
    await user.click(trigger());
    await user.click(within(panel()!).getByRole('link', { name: /^Color palette/ }));
    expect(panel()).toBeNull();
  });

  it('closes on a new page', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Header />);
    await user.click(trigger());
    expect(panel()).not.toBeNull();
    route.pathname = '/color-picker';
    act(() => rerender(<Header />));
    expect(panel()).toBeNull();
  });
});

describe('Star on GitHub', () => {
  const star = () => primary().getByRole('link', { name: /^Star on GitHub/ });

  it('replaces the GitHub icon and leads to the repository in a new tab', () => {
    render(<Header stars={undefined} />);
    expect(star()).toHaveAttribute('href', 'https://github.com/Meerzus/cloudlet');
    expect(star()).toHaveAttribute('target', '_blank');
    expect(screen.queryByRole('link', { name: 'Cloudlet on GitHub' })).toBeNull();
  });

  it('shows no count without one or below 100 stars', () => {
    for (const stars of [undefined, 41, 99]) {
      const { unmount } = render(<Header stars={stars} />);
      expect(star()).toHaveAccessibleName('Star on GitHub');
      expect(star()).not.toHaveTextContent(/\d/);
      unmount();
    }
  });

  it('shows the count from 100 stars, in its name too', () => {
    render(<Header stars={1234} />);
    expect(star()).toHaveAccessibleName('Star on GitHub, 1.2k stars');
    expect(star()).toHaveTextContent('1.2k');
  });
});

describe('theme button on phones', () => {
  it('cycles System → Light → Dark → System, naming the current theme and the next', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
    const { setThemePreference } = await import('../../apps/site/src/lib/theme');
    setThemePreference('system');
    const { ThemeToggle } = await vi.importActual<typeof import('../../apps/site/src/components/site/theme-toggle')>(
      '../../apps/site/src/components/site/theme-toggle',
    );
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const cycle = () => screen.getByRole('button', { name: /, switch to/ });

    const seen: [string | undefined, string | null][] = [];
    for (let step = 0; step < 4; step += 1) {
      seen.push([document.documentElement.dataset['theme'], cycle().getAttribute('aria-label')]);
      if (step < 3) await user.click(cycle());
    }
    expect(seen).toEqual([
      ['system', 'System theme, switch to light theme'],
      ['light', 'Light theme, switch to dark theme'],
      ['dark', 'Dark theme, switch to system theme'],
      ['system', 'System theme, switch to light theme'],
    ]);
    // The three segments stay for wider screens and follow the same preference.
    expect(screen.getByRole('button', { name: 'System theme' })).toHaveAttribute('aria-pressed', 'true');
  });
});
