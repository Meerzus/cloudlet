import { describe, expect, it } from 'vitest';
import { visibleViewport } from '../../packages/toast/src/react/viewport.js';

describe('layout/visual viewport intersection', () => {
  it.each([undefined, null])('uses the complete layout viewport without a visual viewport (%s)', visual => {
    expect(visibleViewport(390, 844, visual)).toEqual({
      left: 0, top: 0, right: 0, bottom: 0, width: 390, height: 844,
    });
  });

  it('returns four physical edge crops in layout CSS pixels', () => {
    expect(visibleViewport(390, 844, { offsetLeft: 12, offsetTop: 34, width: 340, height: 600 })).toEqual({
      left: 12, top: 34, right: 38, bottom: 210, width: 340, height: 600,
    });
  });

  it('clips a larger visual rectangle at all layout edges', () => {
    expect(visibleViewport(390, 844, { offsetLeft: -20, offsetTop: -30, width: 500, height: 900 })).toEqual({
      left: 0, top: 0, right: 0, bottom: 0, width: 390, height: 844,
    });
  });

  it('does not read pinch scale or apply an inverse scale', () => {
    const visual = {
      offsetLeft: 55, offsetTop: 70, width: 195, height: 422,
      get scale(): number { throw new Error('Pinch scale must stay browser-owned'); },
    };
    expect(visibleViewport(390, 844, visual)).toEqual({
      left: 55, top: 70, right: 140, bottom: 352, width: 195, height: 422,
    });
  });

  it.each([
    [{ offsetLeft: 400, offsetTop: 900, width: 100, height: 100 }, { left: 390, top: 844, right: 0, bottom: 0 }],
    [{ offsetLeft: -120, offsetTop: -110, width: 100, height: 100 }, { left: 0, top: 0, right: 390, bottom: 844 }],
    [{ offsetLeft: 100, offsetTop: 200, width: 0, height: 0 }, { left: 100, top: 200, right: 290, bottom: 644 }],
  ])('returns an empty nonnegative intersection for %j', (visual, edges) => {
    expect(visibleViewport(390, 844, visual)).toEqual({ ...edges, width: 0, height: 0 });
  });

  it('retains fractional CSS pixels and conserves each layout dimension', () => {
    const rect = visibleViewport(390.5, 844.25, { offsetLeft: 10.25, offsetTop: 20.5, width: 300.125, height: 500.25 });
    expect(rect).toEqual({ left: 10.25, top: 20.5, right: 80.125, bottom: 323.5, width: 300.125, height: 500.25 });
    expect(rect.left + rect.width + rect.right).toBe(390.5);
    expect(rect.top + rect.height + rect.bottom).toBe(844.25);
  });
});
