import { useEffect, useState } from 'react';
import { AUTO_BREAKPOINT } from '@/lib/toaster-settings';

/** Whether the viewport is at least AUTO_BREAKPOINT wide; true before mount, as on a desktop. */
export function useWide() {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const media = window.matchMedia(`(min-width: ${AUTO_BREAKPOINT})`);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return wide;
}
