import { WORDMARK_WIDTHS, WORDMARKS } from '@/lib/wordmark.generated';

/** The owner's wordmark rendered as cloud (the footer draws the same one). */
const [WORDMARK] = WORDMARKS;
const SIZES = '(max-width: 63.99rem) min(88vw, 34rem), min(46vw, 44rem)';

function Wordmark({ theme }: { theme: 'day' | 'night' }) {
  const set = (format: 'avif' | 'webp') =>
    WORDMARK_WIDTHS.map((width) => `/wordmark/wordmark-${WORDMARK.id}-${theme}-${width}.${format} ${width}w`).join(', ');
  return (
    <picture className={`cloud-${theme}`}>
      <source type="image/avif" srcSet={set('avif')} sizes={SIZES} />
      {/* Lazy, so the theme that is not shown (display: none) is never fetched; the shown one is on screen at once. */}
      <img
        src={`/wordmark/wordmark-${WORDMARK.id}-${theme}-${WORDMARK_WIDTHS[0]}.webp`}
        srcSet={set('webp')}
        sizes={SIZES}
        alt=""
        width={WORDMARK_WIDTHS[0]}
        height={Math.round(WORDMARK_WIDTHS[0] / WORDMARK.aspect)}
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    </picture>
  );
}

/**
 * The kit's name at the top of its landing: "Cloudlet" written in clouds, the day or the night
 * render with the theme, and the word itself for screen readers and search. The one place that
 * draws the name, so setting it in type instead is a change here only.
 */
export function KitName({ id }: { id: string }) {
  return (
    <h1 id={id} className="kit-name" style={{ aspectRatio: String(WORDMARK.aspect) }}>
      <span className="sr-only">Cloudlet</span>
      <span aria-hidden="true" className="kit-wordmark">
        <Wordmark theme="day" />
        <Wordmark theme="night" />
      </span>
    </h1>
  );
}
