import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KitFaq } from '../../apps/site/src/components/kit/kit-faq';
import { AccessProof, MotionProof, ThemeProof } from '../../apps/site/src/components/kit/principles-live';
import { MotionProvider, useMotion, useScrollScene } from '../../apps/site/src/components/site/motion';
import { morphClock } from '../../apps/site/src/components/ui/color-picker/morph';
import { KIT_FAQ } from '../../apps/site/src/lib/kit-faq';
import { setStill, STILL_ATTRIBUTE } from '../../apps/site/src/lib/reduced-motion';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));

let systemReduced = false;
beforeEach(() => {
  systemReduced = false;
  // The system: motion allowed, a touch screen (no Lenis in jsdom), unless a test asks for reduced motion.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('no-preference') ? !systemReduced : query.includes('reduce') ? systemReduced : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
});
afterEach(() => {
  cleanup();
  setStill(false);
  vi.unstubAllGlobals();
});

const scene = { setups: 0, cleanups: 0 };
function Probe() {
  const { reduced } = useMotion();
  const ref = useRef<HTMLDivElement>(null);
  useScrollScene(ref, () => {
    scene.setups += 1;
    return () => {
      scene.cleanups += 1;
    };
  });
  return <div ref={ref} data-testid="probe" data-reduced={String(reduced)} />;
}

describe('the page’s own reduce-motion switch', () => {
  it('reaches useMotion and takes the scenes down, and gives them back', async () => {
    scene.setups = 0;
    scene.cleanups = 0;
    const view = render(
      <MotionProvider>
        <Probe />
        <AccessProof />
      </MotionProvider>,
    );
    const probe = screen.getByTestId('probe');
    await waitFor(() => expect(probe).toHaveAttribute('data-reduced', 'false'), { timeout: 4000 });
    // The scenes are set up once the motion runtime has loaded, which can be a little after the flag.
    await waitFor(() => expect(scene.setups).toBe(1), { timeout: 4000 });

    const toggle = screen.getByRole('switch', { name: 'Reduce motion on this page' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    act(() => toggle.click());
    expect(document.documentElement).toHaveAttribute(STILL_ATTRIBUTE);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(probe).toHaveAttribute('data-reduced', 'true'));
    await waitFor(() => expect(scene.cleanups).toBe(1));
    expect(screen.getByRole('status')).toHaveTextContent('Motion is reduced on this page.');

    act(() => toggle.click());
    expect(document.documentElement).not.toHaveAttribute(STILL_ATTRIBUTE);
    await waitFor(() => expect(probe).toHaveAttribute('data-reduced', 'false'));
    await waitFor(() => expect(scene.setups).toBe(2));
    expect(screen.getByRole('status')).toHaveTextContent('Motion is back on this page.');

    // On again, then the page goes: the attribute leaves <html> (other pages never see it), the choice stays for a return.
    act(() => toggle.click());
    view.unmount();
    expect(document.documentElement).not.toHaveAttribute(STILL_ATTRIBUTE);
    render(<AccessProof />);
    expect(document.documentElement).toHaveAttribute(STILL_ATTRIBUTE);
    expect(screen.getByRole('switch', { name: 'Reduce motion on this page' })).toHaveAttribute('aria-checked', 'true');
  });

  it('shows the system’s choice and does not fight it', () => {
    systemReduced = true;
    render(<AccessProof />);
    const toggle = screen.getByRole('switch', { name: 'Reduce motion on this page' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    act(() => toggle.click());
    expect(document.documentElement).not.toHaveAttribute(STILL_ATTRIBUTE);
    expect(screen.getByText(/Your system already asks for reduced motion/)).toBeInTheDocument();
  });

  it('says honestly that the Toaster follows the system setting', () => {
    render(<AccessProof />);
    expect(screen.getByText(/the Toaster, in the Island and on the phones, follows your system setting/)).toBeInTheDocument();
  });

  it('lines up the stops Tab reaches in the picker', () => {
    render(<AccessProof />);
    const swatch = screen.getByRole('button', { name: 'Open the picker to walk through' });
    const path = document.querySelector('.kp-path')!;
    expect(path).toHaveTextContent('No stops yet');
    fireEvent.focus(swatch);
    expect(path).toHaveTextContent('Open the picker to walk through');
    expect(path.querySelector('[data-current]')).toHaveTextContent('Open the picker to walk through');
  });
});

describe('the motion proof', () => {
  it('slows every picker while slow motion is on, and only then', () => {
    const view = render(<MotionProof />);
    const slow = screen.getByRole('switch', { name: 'Slow motion' });
    act(() => slow.click());
    expect(morphClock.rate).toBe(0.25);
    act(() => slow.click());
    expect(morphClock.rate).toBe(1);
    act(() => slow.click());
    view.unmount();
    expect(morphClock.rate).toBe(1);
  });

  it('says so when motion is off, and slow motion cannot be turned on', () => {
    setStill(true);
    render(<MotionProof />);
    expect(screen.getByText(/Motion is off on this page/)).toBeInTheDocument();
    const slow = screen.getByRole('switch', { name: 'Slow motion' });
    expect(slow).toHaveAttribute('aria-disabled', 'true');
    act(() => slow.click());
    expect(morphClock.rate).toBe(1);
  });
});

describe('the theme proof', () => {
  it('sets the preset on its own wrapper, never on <html>, and says so', () => {
    render(<ThemeProof />);
    const wrapper = document.querySelector<HTMLElement>('.kp-theme')!;
    expect(wrapper).not.toHaveAttribute('data-preset');
    act(() => screen.getByRole('radio', { name: 'Paper' }).click());
    expect(wrapper).toHaveAttribute('data-preset', 'paper');
    expect(wrapper.style.getPropertyValue('--tp-light-background')).toBe('#fcf8f0');
    expect(wrapper.style.getPropertyValue('--tp-font')).toContain('serif');
    expect(document.documentElement.getAttribute('style') ?? '').not.toContain('--tp-');
    expect(screen.getByRole('status')).toHaveTextContent('The picker and the palette now use Paper.');
    // The stylesheet shown is the preset's.
    expect(document.querySelector('.kp-theme-code')).toHaveTextContent('--background: #fcf8f0;');
    act(() => screen.getByRole('radio', { name: 'Cloudlet' }).click());
    expect(wrapper).not.toHaveAttribute('data-preset');
  });
});

describe('the kit’s FAQ', () => {
  it('renders every question as a native disclosure with its answer', () => {
    render(<KitFaq />);
    const items = document.querySelectorAll('details.faq-item');
    expect(items).toHaveLength(KIT_FAQ.length);
    for (const item of KIT_FAQ) expect(screen.getByText(item.question).closest('details')).toHaveTextContent(item.answer);
    expect(document.getElementById('faq')).toHaveAttribute('aria-labelledby', 'kit-faq-title');
  });
});
