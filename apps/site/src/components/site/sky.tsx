'use client';

import { usePathname } from 'next/navigation';
import { useRef, type CSSProperties } from 'react';
import { CLOUD_SHAPES, CLOUD_WIDTHS } from '@/lib/clouds.generated';
import { gsap, ScrollTrigger } from '@/lib/gsap';
import { isQuietPath, PLAYGROUND_PATH } from '@/lib/site';
import { useScrollScene } from './motion';

type ShapeId = (typeof CLOUD_SHAPES)[number]['id'];

interface Cloud {
  readonly shape: ShapeId;
  /** Left edge, % of the viewport width (may be negative to bleed off-screen). */
  readonly x: number;
  /** Top edge, in viewport heights from the top of the layer. */
  readonly y: number;
  /** Width, % of the viewport width (×1.6 on phones). */
  readonly w: number;
  readonly flip?: boolean;
}

interface Layer {
  /** 0 = at the horizon, 1 = closest to the viewer. Drives opacity, blur and parallax. */
  readonly depth: number;
  readonly clouds: readonly Cloud[];
}

/* Blender-rendered layers (scripts/clouds); the first screen keeps the headline area clear. */
const LAYERS: readonly Layer[] = [
  { depth: 0.15, clouds: [{ shape: 3, x: 4, y: 0.6, w: 24 }, { shape: 4, x: 60, y: 0.68, w: 28, flip: true }, { shape: 3, x: 30, y: 1.5, w: 22, flip: true }, { shape: 4, x: 72, y: 1.9, w: 26 }] },
  { depth: 0.35, clouds: [{ shape: 5, x: -6, y: 0.76, w: 24, flip: true }, { shape: 5, x: 76, y: 0.52, w: 20 }, { shape: 5, x: 44, y: 1.35, w: 22 }, { shape: 4, x: 4, y: 2.1, w: 30 }] },
  { depth: 0.6, clouds: [{ shape: 1, x: 26, y: 0.86, w: 40 }, { shape: 5, x: 78, y: 1.2, w: 26, flip: true }, { shape: 6, x: -12, y: 1.75, w: 38 }] },
  { depth: 1, clouds: [{ shape: 6, x: -14, y: 0.92, w: 50 }, { shape: 1, x: 60, y: 1.0, w: 56, flip: true }, { shape: 6, x: 22, y: 2.3, w: 58 }] },
];

/**
 * Each layer repeats every PERIOD viewport heights, so the parallax can run at a fixed
 * rate on a page of any length (the pinned scenes add many screens) and wrap seamlessly.
 * The first copy starts at the top: the first screen is unchanged.
 */
const PERIOD = 2.8;
/** Pixels the nearest layer rises per scrolled pixel; farther layers scale by depth. */
const RATE = 0.3;
/** Least empty sky between the lowest cloud and the next copy, in viewport heights. */
const GAP = 0.3;

const ASPECT = new Map<number, number>(CLOUD_SHAPES.map((shape) => [shape.id, shape.aspect]));

export function CloudImage({ shape, theme, w }: { shape: ShapeId; theme: 'day' | 'night'; w: number }) {
  const set = (format: 'avif' | 'webp') =>
    CLOUD_WIDTHS.map((width) => `/sky/cloud-${shape}-${theme}-${width}.${format} ${width}w`).join(', ');
  const sizes = `(max-width: 640px) ${Math.round(w * 1.6)}vw, ${w}vw`;
  return (
    <picture className={`cloud-${theme}`}>
      <source type="image/avif" srcSet={set('avif')} sizes={sizes} />
      <img
        src={`/sky/cloud-${shape}-${theme}-${CLOUD_WIDTHS[0]}.webp`}
        srcSet={set('webp')}
        sizes={sizes}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    </picture>
  );
}

/** Pages whose sky is a still backdrop (the playground has no scroll effects). */
const STILL_PATHS = [PLAYGROUND_PATH];

export function Sky() {
  const root = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const still = STILL_PATHS.some((path) => pathname.startsWith(path));
  // Reading pages have no sky at all; the hooks below still run so their order is stable.
  const quiet = isQuietPath(pathname);

  useScrollScene(root, () => {
    const layers = gsap.utils.toArray<HTMLElement>('[data-depth]').map((layer) => ({
      element: layer,
      depth: Number(layer.dataset['depth']),
      first: [...layer.querySelectorAll<HTMLElement>('[data-copy="0"] .sky-cloud')],
      second: layer.querySelector<HTMLElement>('[data-copy="1"]'),
      period: PERIOD * window.innerHeight,
      set: gsap.quickSetter(layer, 'y', 'px') as (value: number) => void,
    }));
    // The period must clear the lowest cloud (wide, short screens make clouds tall), or it would pop at the seam.
    const measure = () => {
      for (const layer of layers) {
        const bottom = Math.max(0, ...layer.first.map((cloud) => cloud.offsetTop + cloud.offsetHeight));
        layer.period = Math.max(PERIOD * window.innerHeight, bottom + GAP * window.innerHeight);
        if (layer.second) layer.second.style.top = `${layer.period}px`;
      }
    };
    const update = (scroll: number) => {
      for (const layer of layers) layer.set(-((scroll * RATE * layer.depth) % layer.period));
    };
    measure();
    ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate: (self) => update(self.scroll()),
      onRefresh: (self) => {
        measure();
        update(self.scroll());
      },
    });
    update(window.scrollY);
    // quickSetter writes are not recorded by the context: clear them for the static sky.
    return () => {
      gsap.set(layers.map((layer) => layer.element), { clearProps: 'transform' });
      for (const layer of layers) if (layer.second) layer.second.style.top = `${PERIOD * 100}vh`;
    };
  }, !still && !quiet);

  if (quiet) return null;

  return (
    <div ref={root} aria-hidden="true" className="sky pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="sky-gradient sky-day" />
      <div className="sky-gradient sky-night" />
      <div className="sky-stars" />
      <div className="sky-glow" />
      <div className="sky-clouds">
        {LAYERS.map((layer) => (
          <div
            key={layer.depth}
            data-depth={layer.depth}
            className="sky-layer"
            style={{ '--depth': layer.depth } as CSSProperties}
          >
            {[0, 1].map((copy) => (
              <div key={copy} data-copy={copy} className="sky-copy" style={{ top: `${copy * PERIOD * 100}vh` }}>
                {layer.clouds.map((cloud, index) => (
                  <div
                    key={index}
                    className="sky-cloud"
                    data-flip={cloud.flip ? '' : undefined}
                    style={
                      {
                        left: `${cloud.x}vw`,
                        top: `${cloud.y * 100}vh`,
                        '--w': `${cloud.w}vw`,
                        aspectRatio: String(ASPECT.get(cloud.shape)),
                      } as CSSProperties
                    }
                  >
                    <CloudImage shape={cloud.shape} theme="day" w={cloud.w} />
                    <CloudImage shape={cloud.shape} theme="night" w={cloud.w} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
