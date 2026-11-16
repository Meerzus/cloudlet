'use client';

import Link from 'next/link';
import { useLayoutEffect, useRef, useState } from 'react';
import { PROTOTYPES, type ProtoId } from './slogans';

const SIZES = {
  desktop: { label: '1440', width: 1440, height: 900 },
  phone: { label: '390', width: 390, height: 844 },
} as const;
type Size = keyof typeof SIZES;

/** One prototype in a frame of the chosen viewport, scaled down to the column. */
function Frame({ id, size }: { id: ProtoId; size: Size }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const { width, height } = SIZES[size];

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setScale(Math.min(1, element.clientWidth / width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);

  return (
    <div ref={box} className="proto-frame" style={{ height: scale ? height * scale : undefined, maxWidth: width }}>
      {scale ? (
        <iframe
          key={size}
          src={`/proto/${id}`}
          title={`Prototype ${id.toUpperCase()} at ${width} px`}
          width={width}
          height={height}
          style={{ transform: `scale(${scale})` }}
        />
      ) : null}
    </div>
  );
}

/** The three prototypes side by side at the same width, each with a link to its full-screen page. */
export function Compare() {
  const [size, setSize] = useState<Size>('desktop');
  return (
    <main className="proto-compare">
      <div className="proto-compare-bar">
        <h1>Hero prototypes</h1>
        <div role="group" aria-label="Viewport width" className="proto-compare-sizes">
          {(Object.keys(SIZES) as Size[]).map((key) => (
            <button key={key} type="button" aria-pressed={size === key} onClick={() => setSize(key)}>
              {SIZES[key].label}
            </button>
          ))}
        </div>
        <p>The header&apos;s theme switch changes all three. Each frame has its own slogan switch in its corner.</p>
      </div>
      <div className="proto-compare-grid" data-size={size}>
        {PROTOTYPES.map((proto) => (
          <figure key={proto.id}>
            <figcaption>
              <span className="proto-compare-name">
                {proto.id.toUpperCase()}. {proto.name}
              </span>
              <Link href={`/proto/${proto.id}`}>Full screen →</Link>
              <span className="proto-compare-idea">{proto.idea}</span>
            </figcaption>
            <Frame id={proto.id} size={size} />
          </figure>
        ))}
      </div>
    </main>
  );
}
