import type { SkyLayer } from '@/components/site/sky';

/**
 * The kit's sky: three layers of the Toaster's clouds behind everything under the hero. While the
 * hero covers the screen they are hidden (kit.css), because the hero is paint, not sky; they come in as the hero scrolls away and rise by depth like the Toaster's sky. The
 * clouds load lazily, once shown. Hidden, they cannot be measured, so every cloud ends well above
 * the next period (2.8 screens): the lowest by 2.6 on a screen as short as 600 px at 1440.
 */
export const KIT_SKY_LAYERS: readonly SkyLayer[] = [
  {
    depth: 0.35,
    clouds: [
      { shape: 5, x: -6, y: 0.55, w: 24, flip: true },
      { shape: 3, x: 72, y: 0.95, w: 24 },
      { shape: 4, x: 30, y: 1.6, w: 28 },
      { shape: 5, x: 78, y: 2.2, w: 20 },
    ],
  },
  {
    depth: 0.6,
    clouds: [
      { shape: 1, x: 54, y: 0.7, w: 40 },
      { shape: 5, x: -8, y: 1.3, w: 26, flip: true },
      { shape: 3, x: 66, y: 1.95, w: 26 },
    ],
  },
  {
    depth: 1,
    clouds: [
      { shape: 6, x: -14, y: 0.9, w: 46 },
      { shape: 1, x: 60, y: 1.55, w: 54, flip: true },
      { shape: 6, x: 20, y: 2.0, w: 46 },
    ],
  },
];
