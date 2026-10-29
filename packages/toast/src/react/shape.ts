const finite = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
const number = (value: number) => String(Math.round(value * 1000) / 1000);
// Cubic Bézier handle length for a quarter circle.
const curve = 0.5522847498;

/**
 * One whole rounded rectangle, the only silhouette of the pill and the Island.
 * The same string feeds the SVG background `d` and the HTML `clip-path: path()`.
 * Invalid or negative sizes collapse to zero; the radius never exceeds half a side.
 */
export function createRoundedRectPath(width: number, height: number, radius: number, x = 0, y = 0): string {
  const w = finite(width);
  const h = finite(height);
  const r = Math.min(finite(radius), w / 2, h / 2);
  const left = Number.isFinite(x) ? x : 0;
  const top = Number.isFinite(y) ? y : 0;
  const right = left + w;
  const bottom = top + h;
  const k = r * curve;
  const p = (px: number, py: number) => `${number(px)} ${number(py)}`;
  return [
    `M ${p(left + r, top)}`,
    `L ${p(right - r, top)}`,
    `C ${p(right - r + k, top)} ${p(right, top + r - k)} ${p(right, top + r)}`,
    `L ${p(right, bottom - r)}`,
    `C ${p(right, bottom - r + k)} ${p(right - r + k, bottom)} ${p(right - r, bottom)}`,
    `L ${p(left + r, bottom)}`,
    `C ${p(left + r - k, bottom)} ${p(left, bottom - r + k)} ${p(left, bottom - r)}`,
    `L ${p(left, top + r)}`,
    `C ${p(left, top + r - k)} ${p(left + r - k, top)} ${p(left + r, top)}`,
    'Z',
  ].join(' ');
}
