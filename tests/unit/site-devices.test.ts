import { describe, expect, it } from 'vitest';
import {
  BUTTON_IDS,
  FINISHES,
  RING_SLOTS,
  SHELLS,
  bodySize,
  ringShadow,
  shellOf,
  skeletonOf,
  type ShellId,
} from '../../apps/site/src/lib/devices';

const SHELL_IDS = Object.keys(SHELLS) as ShellId[];

describe('site device catalog', () => {
  it.each(SHELL_IDS)('%s: viewport keeps the screen proportions and the body fits the footprint', (id) => {
    const shell = SHELLS[id];
    const screen = shell.screen.width / shell.screen.height;
    const viewport = shell.viewport.width / shell.viewport.height;
    expect(Math.abs(screen - viewport) / screen).toBeLessThan(0.005);
    const body = bodySize(shell);
    expect(shell.body.x + body.width).toBeLessThanOrEqual(shell.footprint.width + 0.01);
    expect(shell.body.y + body.height).toBeLessThanOrEqual(shell.footprint.height + 0.01);
    const { cutout } = shell;
    expect(cutout.x).toBeGreaterThanOrEqual(0);
    expect(cutout.x + cutout.width).toBeLessThanOrEqual(body.width);
  });

  it.each(SHELL_IDS)('%s: every ring has a colour in both finishes and the edge has a fixed shape', (id) => {
    const rings = SHELLS[id].rings;
    expect(rings.length).toBeLessThanOrEqual(RING_SLOTS);
    for (const finish of ['light', 'dark'] as const) {
      expect(FINISHES[id][finish].rings).toHaveLength(rings.length);
      const shadow = ringShadow(id, finish);
      // RING_SLOTS rings plus the glass: equal lists let CSS interpolate the edge between shells.
      expect(shadow.split(/,(?![^(]*\))/)).toHaveLength(RING_SLOTS + 1);
      expect(shadow).not.toContain('undefined');
    }
    for (let index = 1; index < rings.length; index += 1) expect(rings[index]).toBeGreaterThan(rings[index - 1]!);
  });

  it('names only known buttons and picks skeletons per shape', () => {
    for (const id of SHELL_IDS) for (const button of Object.keys(SHELLS[id].buttons)) expect(BUTTON_IDS).toContain(button);
    expect(shellOf('foldable', 'open')).toBe('foldable-open');
    expect(shellOf('tablet', 'open')).toBe('tablet');
    expect(skeletonOf('laptop')).toBe('desktop');
    expect(skeletonOf('foldable-closed')).toBe('mobile');
    expect(skeletonOf('foldable-open')).toBe('tablet');
  });
});
