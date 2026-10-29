import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Edge = 'top' | 'bottom';

const TOWARDS: Record<Edge, string> = { top: 'to top', bottom: 'to bottom' };
const OPPOSITE: Record<Edge, Edge> = { top: 'bottom', bottom: 'top' };

/**
 * Backdrop kept around a layer's band, in blur radii. A backdrop blur reads only the layer's own
 * box (mirrored at its sides), so the box must clear the band by the reach of the blur; at two
 * radii the cut changes no pixel by more than 1/255.
 */
const REACH = 2;

/** Mask of layer `index`: a band that ramps in, holds and ramps out, `index` bands in from the inner side. */
function band(index: number, count: number, edge: Edge): string {
  const step = 100 / count;
  const at = (bands: number) => `${Math.min(100, Math.round(step * bands * 10) / 10)}%`;
  const stops = [`transparent ${at(index)}`, `black ${at(index + 1)}`];
  if (index + 2 <= count) stops.push(`black ${at(index + 2)}`);
  if (index + 3 <= count) stops.push(`transparent ${at(index + 3)}`);
  return `linear-gradient(${TOWARDS[edge]}, ${stops.join(', ')})`;
}

/**
 * Progressive blur along one viewport edge: stacked `backdrop-filter` layers whose masks overlap,
 * each twice as blurred as the one before it, so content softens gradually as it slides under the
 * edge. The strip is fixed and takes no pointer; its stacking layer comes from `className`.
 *
 * Each layer's box is cut down to its band plus the blur's reach, its mask still laid out over the
 * whole strip: a backdrop filter costs its box's area every frame, and without a GPU (software
 * compositing) the full-height layers alone took most of a 60 Hz frame.
 */
export function EdgeBlur({
  edge,
  height,
  strength = 1,
  layers = 5,
  className,
  children,
}: {
  edge: Edge;
  /** Any CSS length; cap it by the viewport so a short window keeps most of the page sharp. */
  height: string;
  /** Blur radius at the edge, in rem; every layer further in halves it. */
  strength?: number;
  layers?: number;
  className?: string;
  /** Extra layers drawn over the blur, such as a tint. */
  children?: ReactNode;
}) {
  const inner = OPPOSITE[edge];
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none fixed inset-x-0', className)}
      style={{ [edge]: 0, height, '--edge-height': height } as CSSProperties}
    >
      {Array.from({ length: layers }, (_, index) => {
        const mask = band(index, layers, edge);
        const radius = strength / 2 ** (layers - 1 - index);
        const blur = `blur(${radius.toFixed(4)}rem)`;
        // Distances from the strip's inner and outer sides to the layer's box.
        const cut = (bands: number) => `max(0px, calc(var(--edge-height) * ${bands / layers} - ${(REACH * radius).toFixed(4)}rem))`;
        const offsets = { [inner]: cut(index), [edge]: cut(layers - Math.min(layers, index + 3)) };
        const style: CSSProperties = {
          ...offsets,
          maskImage: mask,
          WebkitMaskImage: mask,
          maskSize: '100% var(--edge-height)',
          WebkitMaskSize: '100% var(--edge-height)',
          maskPosition: `0 calc(-1 * ${offsets.top})`,
          WebkitMaskPosition: `0 calc(-1 * ${offsets.top})`,
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          backdropFilter: blur,
          WebkitBackdropFilter: blur,
        };
        return <div key={index} className="absolute inset-x-0" style={style} />;
      })}
      {children}
    </div>
  );
}
