import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactCloudletController } from '../../packages/toast/src/index.js';
import { DEMO_FOLD_LINES, DemoBlock, type DemoItem } from '../../apps/site/src/components/docs/demo-block';
import { findDemo } from '../../apps/site/src/lib/demos';

/**
 * The documentation's demo block (DOCS.md §6): a stage with a button per demo above the code.
 * The page-level controller and the clipboard are the site's own hooks, stubbed here: the block
 * is about which entry runs, which snippet is shown and copied, and when a long one folds.
 */
type Stub = Pick<ReactCloudletController, 'show' | 'track' | 'update'>;
const page = vi.hoisted(() => ({
  controller: null as Stub | null,
  copied: '',
}));

/** Enough of a controller for the catalog entries pressed here; nothing is shown. */
function stub(): Stub {
  return {
    show: vi.fn(),
    track: vi.fn(() => ({ admission: { status: 'rejected', reason: 'disposed' }, result: new Promise(() => {}) })) as unknown as Stub['track'],
    update: vi.fn(),
  };
}

vi.mock('@/components/site/notifications', () => ({
  usePageNotifications: () => page.controller,
  useCopy: () => async (text: string) => {
    page.copied = text;
    return true;
  },
}));

/** A fence of the catalog as the MDX pipeline hands it over: the id and its code. */
function item(id: string): DemoItem {
  const demo = findDemo(id);
  if (!demo) throw new Error(`Unknown demo ${id}`);
  return { id, code: <code>{demo.snippet}</code> };
}

const shownCode = () => document.querySelector('.docs-demo pre')?.textContent;
const title = () => document.querySelector('.docs-code-title')?.textContent;

beforeEach(() => {
  page.controller = stub();
  page.copied = '';
});
afterEach(cleanup);

describe('docs demo block (DOCS.md §6)', () => {
  it('runs the entry on the page controller and, in a group, selects its snippet', () => {
    render(<DemoBlock items={[item('success'), item('warning')]} />);
    const buttons = screen.getAllByRole('button', { name: /Success|Warning/ });
    expect(buttons.map((button) => button.textContent)).toEqual(['Success', 'Warning']);
    expect(screen.getByRole('group', { name: 'Examples' })).toBeInTheDocument();
    expect(buttons[0]).toHaveAttribute('aria-current', 'true');
    expect(buttons[1]).not.toHaveAttribute('aria-current');
    expect(title()).toBe('success');
    expect(shownCode()).toBe(findDemo('success')!.snippet);

    fireEvent.click(buttons[1]!);
    expect(page.controller!.show).toHaveBeenCalledTimes(1);
    expect(page.controller!.show).toHaveBeenCalledWith({ title: 'Clouds are gathering', kind: 'warning' });
    expect(buttons[1]).toHaveAttribute('aria-current', 'true');
    expect(buttons[0]).not.toHaveAttribute('aria-current');
    expect(title()).toBe('warning');
    expect(shownCode()).toBe(findDemo('warning')!.snippet);
    expect(document.querySelector('.docs-demo')).toHaveAttribute('data-demo', 'warning');
  });

  it('copies the snippet on show, and the name says which one', async () => {
    render(<DemoBlock items={[item('success'), item('warning')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Warning' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy warning' }));
    });
    expect(page.copied).toBe(findDemo('warning')!.snippet);
    expect(screen.getByRole('button', { name: 'Copied warning' })).toBeInTheDocument();
  });

  it('is one plain button for a single entry: no group, no current item', () => {
    render(<DemoBlock items={[item('success')]} note />);
    const button = screen.getByRole('button', { name: 'Success' });
    expect(button).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('group')).toBeNull();
    expect(document.querySelector('.docs-demo-note')).toHaveTextContent('Snippets assume const cloudlet = useCloudlet();');
    fireEvent.click(button);
    expect(page.controller!.show).toHaveBeenCalledWith({ title: 'Synced to the cloud', kind: 'success' });
  });

  it('starts folded past the line limit and unfolds under Show code; a new selection folds again', () => {
    const long = findDemo('promise-progress')!;
    expect(long.snippet.split('\n').length).toBeGreaterThan(DEMO_FOLD_LINES);
    render(<DemoBlock items={[item('promise-progress'), item('success')]} />);
    const area = document.querySelector('.docs-demo-code')!;
    expect(area).toHaveAttribute('data-folded');
    const fold = screen.getByRole('button', { name: 'Show code' });
    expect(fold).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(fold);
    expect(area).not.toHaveAttribute('data-folded');
    expect(screen.getByRole('button', { name: 'Hide code' })).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Success' }));
    expect(screen.queryByRole('button', { name: /code$/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Progress' }));
    expect(area).toHaveAttribute('data-folded');
  });

  it('keeps the buttons disabled until the page has a controller (server render)', () => {
    page.controller = null;
    render(<DemoBlock items={[item('success')]} />);
    expect(screen.getByRole('button', { name: 'Success' })).toBeDisabled();
  });

  it('fails the build on an id the catalog does not know', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<DemoBlock items={[{ id: 'no-such-demo', code: <code /> }]} />)).toThrow(/Unknown demo "no-such-demo"/u);
  });
});
