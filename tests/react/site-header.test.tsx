import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Header } from '../../apps/site/src/components/site/header';

const route = vi.hoisted(() => ({ pathname: '/toaster' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('@/components/site/theme-toggle', () => ({ ThemeToggle: () => null }));

// jsdom has no ResizeObserver; the switch's sliding highlight only re-measures on it.
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));

describe('site header (COLOR_PICKER §8.1)', () => {
  it('switches between the components and follows the current one', () => {
    route.pathname = '/docs/components/toaster/styling';
    const { unmount } = render(<Header />);
    let components = within(screen.getByRole('navigation', { name: 'Components' }));
    expect(components.getByRole('link', { name: 'Toaster' })).toHaveAttribute('aria-current', 'page');
    expect(components.getByRole('link', { name: 'Color picker' })).toHaveAttribute('href', '/color-picker');
    const primary = within(screen.getByRole('navigation', { name: 'Primary' }));
    expect(primary.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs/components/toaster');
    expect(primary.getByRole('link', { name: 'Playground' })).toHaveAttribute('href', '/toaster/playground');
    unmount();

    route.pathname = '/docs/components/color-picker';
    render(<Header />);
    components = within(screen.getByRole('navigation', { name: 'Components' }));
    expect(components.getByRole('link', { name: 'Color picker' })).toHaveAttribute('aria-current', 'page');
    expect(components.getByRole('link', { name: 'Toaster' })).not.toHaveAttribute('aria-current');
    const picker = within(screen.getByRole('navigation', { name: 'Primary' }));
    expect(picker.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs/components/color-picker');
    expect(picker.queryByRole('link', { name: 'Playground' })).toBeNull();
  });

  it("leads Docs to the docs of the whole kit from the kit's own pages", () => {
    for (const pathname of ['/', '/docs', '/docs/installation']) {
      route.pathname = pathname;
      const { unmount } = render(<Header />);
      const primary = within(screen.getByRole('navigation', { name: 'Primary' }));
      expect(primary.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs');
      // The switch shows the two landings only; the palette is not in it.
      const components = within(screen.getByRole('navigation', { name: 'Components' }));
      expect(components.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/toaster', '/color-picker']);
      unmount();
    }
  });
});
