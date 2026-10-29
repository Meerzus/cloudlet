import type { SVGProps } from 'react';

const PILL = 'M18 65H106A17 17 0 0 1 106 99H18A17 17 0 0 1 18 65Z';

/**
 * The app icon: the white toaster mark (pill, small dome, big dome, split by a gap) on the
 * --ring → --sky-top tile. This is the small-size cut (wider gap, larger mark),
 * the same as app/icon.svg. `idPrefix` must be unique per page.
 */
export function CloudletIcon({ idPrefix, ...props }: SVGProps<SVGSVGElement> & { idPrefix: string }) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const cut = (
    <>
      <rect x="-50" y="-80" width="250" height="250" fill="#fff" />
      <path d={PILL} stroke="#000" strokeWidth="11" />
      <rect x="-50" y="65" width="250" height="80" />
    </>
  );
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id={id('tile')} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="32">
          <stop offset="0" stopColor="#1570d1" />
          <stop offset="1" stopColor="#2785ce" />
        </linearGradient>
        <mask id={id('small')} maskUnits="userSpaceOnUse" x="-50" y="-80" width="250" height="250">
          {cut}
        </mask>
        <mask id={id('big')} maskUnits="userSpaceOnUse" x="-50" y="-80" width="250" height="250">
          {cut}
          <circle cx="42" cy="63" r="27.5" />
        </mask>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id('tile')})`} />
      <g transform="translate(2.99 2.78) scale(0.20984)" fill="#fff">
        <circle mask={`url(#${id('big')})`} cx="77" cy="56" r="29" />
        <circle mask={`url(#${id('small')})`} cx="42" cy="63" r="22" />
        <path d={PILL} />
      </g>
    </svg>
  );
}

export function GitHubMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.82 1.19 3.08 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}
