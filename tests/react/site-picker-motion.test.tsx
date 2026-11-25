import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

/** A WebGL 2 context that names its renderer, as Chrome does through WEBGL_debug_renderer_info. */
function fakeGL(renderer: string) {
  const loseContext = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    RENDERER: 0x1f01,
    getExtension: (name: string) => (name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : name === 'WEBGL_lose_context' ? { loseContext } : null),
    getParameter: (parameter: number) => (parameter === 0x9246 ? renderer : 'WebKit WebGL'),
  } as unknown as RenderingContext);
  return loseContext;
}

describe('the landing cards hold still while the page scrolls and on a software WebGL', () => {
  it('watchScroll says when scrolling starts, once, and when it has been still for the idle time', async () => {
    vi.useFakeTimers();
    const { watchScroll } = await import('../../apps/site/src/lib/picker-motion');
    const seen: boolean[] = [];
    const stop = watchScroll((scrolling) => seen.push(scrolling), 160);
    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(100);
    window.dispatchEvent(new Event('scroll'));
    expect(seen).toEqual([true]);
    vi.advanceTimersByTime(159);
    expect(seen).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([true, false]);
    stop();
    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([true, false]);
  });

  it('softwareGL is true for SwiftShader and llvmpipe, false for a GPU, and lets its probe context go', async () => {
    for (const [renderer, software] of [
      ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', true],
      ['llvmpipe (LLVM 17.0.6, 256 bits)', true],
      ['ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics OpenGL Engine, OpenGL 4.1)', false],
      ['Apple M2', false],
    ] as const) {
      vi.resetModules();
      vi.restoreAllMocks();
      const lose = fakeGL(renderer);
      const { softwareGL } = await import('../../apps/site/src/lib/picker-motion');
      expect(softwareGL(), renderer).toBe(software);
      expect(lose).toHaveBeenCalledOnce();
    }
  });

  it('softwareGL without WebGL 2 is false: the flat background takes over there anyway', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { softwareGL } = await import('../../apps/site/src/lib/picker-motion');
    expect(softwareGL()).toBe(false);
  });
});
