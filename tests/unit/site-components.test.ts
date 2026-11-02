import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLOR_PICKER_DOCS_PATH, COLOR_PICKER_PATH, COMPONENTS, componentOf, DOCS_PATH, isQuietPath, PLAYGROUND_PATH, TOASTER_PATH } from '../../apps/site/src/lib/site';

const app = (path: string) => new URL(`../../apps/site/src/app/${path}`, import.meta.url);

describe('site components (COLOR_PICKER §8.1, §8.7, §9)', () => {
  it('knows which component a page belongs to; the Toaster owns everything else', () => {
    expect(COMPONENTS.map((component) => component.id)).toEqual(['toaster', 'color-picker']);
    expect(componentOf(TOASTER_PATH).docs).toBe(DOCS_PATH);
    expect(componentOf(PLAYGROUND_PATH).id).toBe('toaster');
    expect(componentOf(COLOR_PICKER_PATH).docs).toBe(COLOR_PICKER_DOCS_PATH);
    expect(componentOf(`${COLOR_PICKER_DOCS_PATH}`).id).toBe('color-picker');
    expect(componentOf('/color-pickers').id).toBe('toaster');
    expect(componentOf('/').id).toBe('toaster');
    // Only the Toaster has a Playground.
    expect(COMPONENTS.map((component) => Boolean(component.playground))).toEqual([true, false]);
  });

  it('reads both docs quietly: no sky, no Lenis', () => {
    expect(isQuietPath(COLOR_PICKER_DOCS_PATH)).toBe(true);
    expect(isQuietPath(`${DOCS_PATH}/styling`)).toBe(true);
    expect(isQuietPath(COLOR_PICKER_PATH)).toBe(false);
  });

  it('ships the color picker card as a JPEG of 1200×630 with its alt text', () => {
    for (const name of ['opengraph-image', 'twitter-image']) {
      const jpeg = readFileSync(app(`color-picker/${name}.jpg`));
      expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      // The baseline frame header (SOF0) holds the height, then the width.
      const sof = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
      expect([jpeg.readUInt16BE(sof + 7), jpeg.readUInt16BE(sof + 5)]).toEqual([1200, 630]);
      expect(statSync(app(`color-picker/${name}.jpg`)).size).toBeLessThan(400_000);
      expect(readFileSync(app(`color-picker/${name}.alt.txt`), 'utf8')).toMatch(/^Cloudlet Color Picker/);
    }
  });
});
