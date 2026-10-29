import type { Metadata } from 'next';
import { FrameApp } from '@/components/frame/frame-app';
import { DesktopSkeleton, MobileSkeleton, TabletSkeleton } from '@/components/frame/frame-skeleton';

export const metadata: Metadata = {
  title: 'Cloudlet — device screen',
  robots: { index: false, follow: false },
};

/**
 * Runs before the skeleton paints: the URL decides the device and theme, overriding
 * the site preference the root boot script applied. Dependency-free ES5.
 *
 * It also makes the screen behave as the active window of its device: an iframe document
 * never has focus while the visitor is on the page, so the Toaster would hold its
 * `window-blur` pause and success toasts would never leave. `hasFocus` reports true and the
 * window's own blur is stopped before the Toaster hears it; the library is untouched.
 */
const FRAME_INIT_SCRIPT = `(function(){try{var q=new URLSearchParams(location.search);var r=document.documentElement;var d=q.get('theme')==='dark';r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';var v=q.get('device');r.setAttribute('data-device',v==='phone'||v==='tablet'||v==='foldable'?v:'laptop');r.setAttribute('data-frame','');document.hasFocus=function(){return true};window.addEventListener('blur',function(e){if(e.target===window)e.stopImmediatePropagation()},true)}catch(e){}})()`;

/** Service route for the hero device screen; not linked from the site. */
export default function Frame() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: FRAME_INIT_SCRIPT }} />
      <div className="frame-screen" aria-hidden="true">
        <DesktopSkeleton />
        <MobileSkeleton />
        <TabletSkeleton />
      </div>
      <FrameApp />
    </>
  );
}
