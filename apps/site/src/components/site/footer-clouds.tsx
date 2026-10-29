import type { CSSProperties, Ref } from 'react';
import { CLOUD_SHAPES } from '@/lib/clouds.generated';
import { CloudImage } from './sky';

type ShapeId = (typeof CLOUD_SHAPES)[number]['id'];

const ASPECT = new Map<number, number>(CLOUD_SHAPES.map((shape) => [shape.id, shape.aspect]));

interface BankCloud {
  readonly shape: ShapeId;
  /** Left edge, % of the bank's width; kept in [0, 100) so a copy one width to the left wraps it. */
  readonly x: number;
  /** Bottom edge, % of the bank's height (negative sinks it below the page end). */
  readonly bottom: number;
  /** Width, % of the bank's width. */
  readonly w: number;
  readonly flip?: boolean;
}

export interface BankLayer {
  /** 0 = far, 1 = near, as in the sky: drives opacity, blur, parallax and drift speed. */
  readonly depth: number;
  readonly clouds: readonly BankCloud[];
}

/**
 * The footer's own bank of sky clouds along the bottom of the wordmark's screen, so the end of the
 * page always has clouds below the letters, wherever the sky's repeating layers happen to be.
 */
export const BANK: readonly BankLayer[] = [
  { depth: 0.35, clouds: [{ shape: 4, x: 6, bottom: 30, w: 24 }, { shape: 5, x: 62, bottom: 24, w: 16, flip: true }] },
  { depth: 0.6, clouds: [{ shape: 1, x: 0, bottom: 10, w: 38 }, { shape: 6, x: 52, bottom: 6, w: 34, flip: true }] },
  { depth: 1, clouds: [{ shape: 6, x: 18, bottom: -8, w: 50 }, { shape: 1, x: 70, bottom: -6, w: 44, flip: true }] },
];

/**
 * Each layer is drawn twice, the second copy one bank-width to the left, so a horizontal drift of
 * the layer by its offset modulo the width wraps seamlessly.
 */
export function FooterClouds({ bankRef, layerRefs }: { bankRef: Ref<HTMLDivElement>; layerRefs: (HTMLDivElement | null)[] }) {
  return (
    <div ref={bankRef} className="footer-bank" aria-hidden="true">
      {BANK.map((layer, index) => (
        <div
          key={layer.depth}
          ref={(element) => {
            layerRefs[index] = element;
          }}
          className="footer-bank-layer"
          style={{ '--depth': layer.depth } as CSSProperties}
        >
          {[0, 1].map((copy) => (
            <div key={copy} className="footer-bank-copy" style={{ left: `${-100 * copy}%` }}>
              {layer.clouds.map((cloud, cloudIndex) => (
                <div
                  key={cloudIndex}
                  className="footer-cloud"
                  data-flip={cloud.flip ? '' : undefined}
                  style={
                    {
                      left: `${cloud.x}%`,
                      bottom: `${cloud.bottom}%`,
                      '--w': `${cloud.w}%`,
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
  );
}
