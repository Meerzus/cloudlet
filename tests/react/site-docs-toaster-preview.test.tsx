import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToasterPreview } from '../../apps/site/src/components/docs/toaster-preview';
import { Notifications } from '../../apps/site/src/components/site/notifications';

/**
 * The Preview of the Toaster's component page against the site's real page-level Notifications:
 * its controls move the page Toaster (the host's position and direction), the code under them
 * follows and copies verbatim, and unmounting the Preview (leaving the page) puts the Toaster back.
 */
const screenState = vi.hoisted(() => ({ wide: true, copied: '' }));

beforeEach(() => {
  screenState.wide = true;
  screenState.copied = '';
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width') ? screenState.wide : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => void (screenState.copied = text) },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const host = () => document.querySelector<HTMLElement>('.cloudlet-host');
const code = () => document.querySelector('.docs-preview pre')?.textContent;
const pick = (group: string, option: string) =>
  fireEvent.click(within(screen.getByRole('group', { name: group })).getByRole('radio', { name: option }));

/** The Preview on a page that can leave it, as a docs page does on navigation. */
function Page() {
  const [shown, setShown] = useState(true);
  return (
    <Notifications>
      <button type="button" onClick={() => setShown(false)}>
        Leave
      </button>
      {shown ? <ToasterPreview /> : null}
    </Notifications>
  );
}

describe('docs Toaster preview', () => {
  it('starts at the defaults: the page Toaster at auto, and the code is <Toaster />', async () => {
    render(<Page />);
    await act(async () => {});
    expect(host()).toHaveAttribute('data-position', 'auto');
    expect(host()).toHaveAttribute('dir', 'ltr');
    expect(code()).toBe('<Toaster />');
    expect(screen.getByRole('group', { name: 'Toaster settings' })).toBeInTheDocument();
    for (const name of ['Position', 'Side', 'Direction']) expect(screen.getByRole('group', { name })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Customize the look' })).toHaveAttribute('href', '/docs/components/toaster/styling');
  });

  it('moves the page Toaster with every control, and the code follows', async () => {
    render(<Page />);
    await act(async () => {});
    const steps: [string, string, string, string, string][] = [
      ['Position', 'Top', 'top-center', 'ltr', '<Toaster position="top-center" />'],
      ['Side', 'Left', 'top-left', 'ltr', '<Toaster position="top-left" />'],
      ['Side', 'Right', 'top-right', 'ltr', '<Toaster position="top-right" />'],
      ['Position', 'Bottom', 'bottom-right', 'ltr', '<Toaster position="bottom-right" />'],
      ['Direction', 'RTL', 'bottom-right', 'rtl', '<Toaster position="bottom-right" dir="rtl" />'],
      ['Position', 'Auto', 'top-right', 'rtl', '<Toaster position="top-right" dir="rtl" />'],
      ['Side', 'Center', 'auto', 'rtl', '<Toaster dir="rtl" />'],
      ['Direction', 'LTR', 'auto', 'ltr', '<Toaster />'],
    ];
    for (const [group, option, position, dir, text] of steps) {
      pick(group, option);
      await act(async () => {});
      expect(host(), `${group} ${option}`).toHaveAttribute('data-position', position);
      expect(host(), `${group} ${option}`).toHaveAttribute('dir', dir);
      expect(code(), `${group} ${option}`).toBe(text);
    }
  });

  it('takes the bottom edge for Auto beside the centre on a narrow screen, as position="auto" would', async () => {
    screenState.wide = false;
    render(<Page />);
    await act(async () => {});
    pick('Side', 'Left');
    await act(async () => {});
    expect(host()).toHaveAttribute('data-position', 'bottom-left');
    expect(code()).toBe('<Toaster position="bottom-left" />');
  });

  it('copies the code it shows', async () => {
    render(<Page />);
    await act(async () => {});
    pick('Position', 'Bottom');
    fireEvent.click(screen.getByRole('button', { name: 'Copy Toaster' }));
    await act(async () => {});
    expect(screenState.copied).toBe('<Toaster position="bottom-center" />');
    expect(screen.getByRole('button', { name: 'Copied Toaster' })).toBeInTheDocument();
  });

  it('shows one notification or five on the page Toaster', async () => {
    render(<Page />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Show a notification' }));
    await act(async () => {});
    expect(host()?.textContent).toContain('Synced to the cloud');
    fireEvent.click(screen.getByRole('button', { name: 'Show five' }));
    await act(async () => {});
    // The stack at rest shows the newest, and its pill counts all six.
    expect(host()?.textContent).toContain('Altocumulus drifted by');
    expect(host()?.querySelector('.cloudlet-pill')?.getAttribute('aria-label')).toMatch(/\b6\b/u);
  });

  it('puts the page Toaster back when the Preview goes away', async () => {
    render(<Page />);
    await act(async () => {});
    pick('Position', 'Bottom');
    pick('Side', 'Left');
    pick('Direction', 'RTL');
    await act(async () => {});
    expect(host()).toHaveAttribute('data-position', 'bottom-left');
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await act(async () => {});
    expect(host()).toHaveAttribute('data-position', 'auto');
    // Without page settings the Toaster takes the document's direction again.
    expect(host()?.getAttribute('dir') ?? 'ltr').toBe('ltr');
  });
});
