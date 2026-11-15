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
    route.pathname = '/toaster/docs/styling';
    const { unmount } = render(<Header />);
    let components = within(screen.getByRole('navigation', { name: 'Components' }));
    expect(components.getByRole('link', { name: 'Toaster' })).toHaveAttribute('aria-current', 'page');
    expect(components.getByRole('link', { name: 'Color picker' })).toHaveAttribute('href', '/color-picker');
    const primary = within(screen.getByRole('navigation', { name: 'Primary' }));
    expect(primary.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/toaster/docs');
    expect(primary.getByRole('link', { name: 'Playground' })).toHaveAttribute('href', '/toaster/playground');
    unmount();

    route.pathname = '/color-picker/docs';
    render(<Header />);
    components = within(screen.getByRole('navigation', { name: 'Components' }));
    expect(components.getByRole('link', { name: 'Color picker' })).toHaveAttribute('aria-current', 'page');
    expect(components.getByRole('link', { name: 'Toaster' })).not.toHaveAttribute('aria-current');
    const picker = within(screen.getByRole('navigation', { name: 'Primary' }));
    expect(picker.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/color-picker/docs');
    expect(picker.queryByRole('link', { name: 'Playground' })).toBeNull();
  });
});
