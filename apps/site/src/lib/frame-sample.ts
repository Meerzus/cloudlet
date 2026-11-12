/**
 * Reading a color off the Tools frame (COLOR_PICKER §8.7): a point on the card maps to the source
 * picture the way the card shows it — `object-fit: cover`, then the glass's zoom and drift — and the
 * color comes from the picture itself through a 2D canvas, so it works in every browser, with or
 * without the eyedropper and WebGL.
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Where a point on the card falls on the picture, as fractions of it (0–1, top left first). */
export function framePoint(x: number, y: number, box: Size, image: Size, drift: readonly [number, number] = [0, 0], zoom = 1): { u: number; v: number } {
  const scale = Math.max(box.width / image.width, box.height / image.height);
  const shownWidth = image.width * scale;
  const shownHeight = image.height * scale;
  const u = (x - (box.width - shownWidth) / 2) / shownWidth;
  const v = (y - (box.height - shownHeight) / 2) / shownHeight;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return { u: clamp((u - 0.5) * zoom + 0.5 + drift[0]), v: clamp((v - 0.5) * zoom + 0.5 + drift[1]) };
}

const hexPair = (value: number) => Math.round(value).toString(16).padStart(2, '0');

/** The mean color of the pixels within `radius` of (px, py), as `#rrggbb`: a single pixel of grain is not the color. */
export function averageHex(data: ArrayLike<number>, width: number, height: number, px: number, py: number, radius = 1): string {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = Math.max(0, py - radius); y <= Math.min(height - 1, py + radius); y += 1) {
    for (let x = Math.max(0, px - radius); x <= Math.min(width - 1, px + radius); x += 1) {
      const at = (y * width + x) * 4;
      r += data[at]!;
      g += data[at + 1]!;
      b += data[at + 2]!;
      count += 1;
    }
  }
  return count === 0 ? '#000000' : `#${hexPair(r / count)}${hexPair(g / count)}${hexPair(b / count)}`;
}

/** The picture's pixels, read once; null where a 2D canvas cannot be had. */
export function readPixels(image: HTMLImageElement): { data: Uint8ClampedArray; width: number; height: number } | null {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width === 0 || height === 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0);
  return { data: context.getImageData(0, 0, width, height).data, width, height };
}
