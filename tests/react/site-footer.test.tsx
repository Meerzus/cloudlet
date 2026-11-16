import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FooterSlim } from '../../apps/site/src/components/site/footer-slim';
import { GITHUB_URL, LICENSE_URL } from '../../apps/site/src/lib/site';

describe('footer links', () => {
  it('lead to the kit, each component, the docs, GitHub and the license', () => {
    render(<FooterSlim />);
    const links = within(screen.getByRole('navigation', { name: 'Footer' }));
    const href = (name: string) => links.getByRole('link', { name }).getAttribute('href');
    expect(href('Cloudlet')).toBe('/');
    expect(href('Toaster')).toBe('/toaster');
    expect(href('Color picker')).toBe('/color-picker');
    expect(href('Color palette')).toBe('/color-picker#palette');
    expect(href('Docs')).toBe('/docs');
    expect(href('GitHub')).toBe(GITHUB_URL);
    expect(href('MIT License')).toBe(LICENSE_URL);
  });
});
