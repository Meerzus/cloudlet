import type { ReactElement, SVGProps } from 'react';

/**
 * The five flat glyphs of the Combinations posters (COLOR_PICKER §8.5): a drop, a four-point star,
 * a cloud, a moon with its halo and a zigzag reflection. Filled with currentColor, decorative.
 */
type Glyph = (props: SVGProps<SVGSVGElement>) => ReactElement;

const frame = (props: SVGProps<SVGSVGElement>) => ({ viewBox: '0 0 100 100', fill: 'currentColor', 'aria-hidden': true, focusable: false, ...props }) as const;

export const Drop: Glyph = (props) => (
  <svg {...frame(props)}>
    <path d="M50 6C50 6 17 46 17 66a33 33 0 0 0 66 0C83 46 50 6 50 6Z" />
  </svg>
);

export const Star: Glyph = (props) => (
  <svg {...frame(props)}>
    <path d="M50 2C53 38 62 47 98 50 62 53 53 62 50 98 47 62 38 53 2 50 38 47 47 38 50 2Z" />
  </svg>
);

export const Cloud: Glyph = (props) => (
  <svg {...frame(props)}>
    <circle cx="33" cy="58" r="17" />
    <circle cx="53" cy="47" r="24" />
    <circle cx="74" cy="60" r="15" />
    <rect x="14" y="58" width="76" height="20" rx="10" />
  </svg>
);

export const Moon: Glyph = (props) => (
  <svg {...frame(props)}>
    {/* The halo as thin solid rings: a translucent fill would mix with the paper into grey. */}
    <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="50" cy="50" r="35" fill="none" stroke="currentColor" strokeWidth="2.5" />
    <circle cx="50" cy="50" r="24" />
  </svg>
);

export const Reflection: Glyph = (props) => (
  <svg {...frame(props)}>
    {[0, 1, 2, 3, 4, 5, 6].map((row) => {
      const width = 70 - row * 9;
      const shift = (row % 2 ? 1 : -1) * 6;
      return <rect key={row} x={50 - width / 2 + shift} y={8 + row * 13} width={width} height="6" rx="3" />;
    })}
  </svg>
);
