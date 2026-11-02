#!/usr/bin/env node
/**
 * The film grain tile of the color picker landing's Combinations posters (COLOR_PICKER §8.5):
 * 256×256 grayscale noise around mid-grey, seeded so the file is the same on every run, written as
 * a PNG with node:zlib only. Laid over a poster with `mix-blend-mode: overlay`, mid-grey changes
 * nothing and the noise lightens and darkens around it.
 *
 *   node apps/site/scripts/grain.mjs   → apps/site/public/picker/grain.png
 */
import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const SIZE = 256;
/** Grey levels of the noise: fewer levels, smaller file; 5 read as grain, not steps, under overlay. */
const LEVELS = 5;
const SPREAD = 46;

let seed = 0x5eed;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** A roughly normal sample in [-1, 1]: the mean of three uniforms, stretched. */
const gauss = () => Math.max(-1, Math.min(1, (random() + random() + random() - 1.5) / 1.5 * 1.6));

const rows = Buffer.alloc(SIZE * (SIZE + 1));
for (let y = 0; y < SIZE; y += 1) {
  rows[y * (SIZE + 1)] = 0; // filter: none
  for (let x = 0; x < SIZE; x += 1) {
    const level = Math.round(((gauss() + 1) / 2) * (LEVELS - 1));
    rows[y * (SIZE + 1) + 1 + x] = Math.round(128 - SPREAD + (level / (LEVELS - 1)) * 2 * SPREAD);
  }
}

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};
const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header.set([8, 0, 0, 0, 0], 8); // 8-bit, grayscale, deflate, adaptive filtering, no interlace
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(rows, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = new URL('../public/picker/grain.png', import.meta.url);
writeFileSync(out, png);
console.log(`grain.png: ${png.length} bytes`);
