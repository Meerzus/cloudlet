/**
 * When the landing's WebGL cards (the hero, Palette, Opacity, Tools) may move. Their flow is a 36 s
 * loop over 3 % of the frame: nobody misses it for the second the page scrolls, while each frame of it
 * costs the GPU a full-screen pass. Without a GPU, on a software WebGL (SwiftShader, llvmpipe), that
 * pass takes 60–80 ms and every frame of the page with it, so there the cards hold still, as under
 * reduced motion; they still take every new color.
 */

/** Calls back with true when the page starts scrolling and with false `idle` ms after it stops. */
export function watchScroll(onChange: (scrolling: boolean) => void, idle = 160): () => void {
  let timer = 0;
  let scrolling = false;
  const scroll = () => {
    if (!scrolling) {
      scrolling = true;
      onChange(true);
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      scrolling = false;
      onChange(false);
    }, idle);
  };
  window.addEventListener('scroll', scroll, { passive: true });
  return () => {
    window.removeEventListener('scroll', scroll);
    window.clearTimeout(timer);
  };
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/iu;
let software: boolean | undefined;

/** Whether this browser's WebGL 2 renders on the CPU; asked once, on a throwaway context. */
export function softwareGL(): boolean {
  if (software !== undefined) return software;
  software = false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return software;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    software = SOFTWARE.test(renderer);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // No answer: treat it as a GPU, as before.
  }
  return software;
}
