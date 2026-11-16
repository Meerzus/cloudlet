/** Below this many stars the header's Star button shows no count: a small number reads as a weak signal. */
export const STAR_COUNT_THRESHOLD = 100;

/**
 * The count as the Star button shows it, or undefined below the threshold: `128`, `999`, then
 * `1k`, `1.2k`, `9.9k`, `12k`, `999k`, `1.2M`. Rounded down, so the button never claims a star the
 * repository has not got.
 */
export function formatStars(stars: number | undefined): string | undefined {
  if (stars === undefined || !Number.isFinite(stars) || stars < STAR_COUNT_THRESHOLD) return undefined;
  const whole = Math.floor(stars);
  if (whole < 1000) return String(whole);
  const [value, unit] = whole < 1_000_000 ? [whole / 1000, 'k'] : [whole / 1_000_000, 'M'];
  const shown = value < 10 ? Math.floor(value * 10) / 10 : Math.floor(value);
  return `${shown}${unit}`;
}

/** The count baked in at build time (next.config.mjs), or undefined when GitHub did not answer. */
export function parseStars(value: string | undefined): number | undefined {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
}

/** Inlined by `next build`; empty or missing when there is no count. */
export const BUILD_STARS = parseStars(process.env.NEXT_PUBLIC_GITHUB_STARS);
