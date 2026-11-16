import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COLOR_PALETTE_DOCS_PATH,
  COLOR_PALETTE_PATH,
  COLOR_PICKER_DOCS_PATH,
  COLOR_PICKER_PATH,
  COMPONENTS,
  componentOf,
  DOCS_PATH,
  docsPathOf,
  isQuietPath,
  PLAYGROUND_PATH,
  REGISTRY_ITEMS,
  TOASTER_DOCS_PATH,
  TOASTER_PATH,
} from '../../apps/site/src/lib/site';

const app = (path: string) => new URL(`../../apps/site/src/app/${path}`, import.meta.url);

describe('site components (COLOR_PICKER §8.1, §8.7, §9)', () => {
  it("lists the kit's three components in the kit's order, each with a landing and a docs page", () => {
    expect(COMPONENTS.map(({ id, name, path, docs }) => ({ id, name, path, docs }))).toEqual([
      { id: 'toaster', name: 'Toaster', path: '/toaster', docs: '/docs/components/toaster' },
      { id: 'color-picker', name: 'Color picker', path: '/color-picker', docs: '/docs/components/color-picker' },
      // The palette is a section of the picker's landing and, until its own page, of the picker's docs.
      { id: 'color-palette', name: 'Color palette', path: '/color-picker#palette', docs: '/docs/components/color-picker' },
    ]);
    expect(COMPONENTS.map((component) => component.id)).toEqual([...REGISTRY_ITEMS]);
    expect([COLOR_PALETTE_PATH, COLOR_PALETTE_DOCS_PATH]).toEqual(['/color-picker#palette', COLOR_PICKER_DOCS_PATH]);
    for (const component of COMPONENTS) {
      // One line in the panel: a sentence, short enough not to wrap twice.
      expect(component.description).toMatch(/^[A-Z].*\.$/);
      expect(component.description.length).toBeLessThanOrEqual(80);
    }
  });

  it("knows which component a page belongs to; the kit's own pages belong to none", () => {
    const owner = (pathname: string) => componentOf(pathname)?.id;
    expect(owner(TOASTER_PATH)).toBe('toaster');
    expect(owner(PLAYGROUND_PATH)).toBe('toaster');
    expect(owner(TOASTER_DOCS_PATH)).toBe('toaster');
    expect(owner(`${TOASTER_DOCS_PATH}/api/toaster`)).toBe('toaster');
    expect(owner(`${TOASTER_DOCS_PATH}/styling`)).toBe('toaster');
    expect(owner(COLOR_PICKER_PATH)).toBe('color-picker');
    expect(owner(COLOR_PICKER_DOCS_PATH)).toBe('color-picker');
    expect(owner('/')).toBeUndefined();
    expect(owner(DOCS_PATH)).toBeUndefined();
    expect(owner(`${DOCS_PATH}/installation`)).toBeUndefined();
    expect(owner(`${COLOR_PICKER_DOCS_PATH}s`)).toBeUndefined();
    expect(owner('/color-pickers')).toBeUndefined();
    expect(owner('/toasters')).toBeUndefined();
    expect(owner('/nowhere')).toBeUndefined();
  });

  it("leads Docs to the page's component in the docs, or to the docs of the whole kit", () => {
    expect(docsPathOf(TOASTER_PATH)).toBe(TOASTER_DOCS_PATH);
    expect(docsPathOf(PLAYGROUND_PATH)).toBe(TOASTER_DOCS_PATH);
    expect(docsPathOf(`${TOASTER_DOCS_PATH}/styling`)).toBe(TOASTER_DOCS_PATH);
    expect(docsPathOf(COLOR_PICKER_PATH)).toBe(COLOR_PICKER_DOCS_PATH);
    expect(docsPathOf(COLOR_PICKER_DOCS_PATH)).toBe(COLOR_PICKER_DOCS_PATH);
    expect(docsPathOf('/')).toBe(DOCS_PATH);
    expect(docsPathOf(DOCS_PATH)).toBe(DOCS_PATH);
    expect(docsPathOf(`${DOCS_PATH}/installation`)).toBe(DOCS_PATH);
    expect(docsPathOf(`${COLOR_PICKER_DOCS_PATH}s`)).toBe(DOCS_PATH);
    expect(docsPathOf('/nowhere')).toBe(DOCS_PATH);
  });

  it('reads everything under /docs quietly: no sky, no Lenis', () => {
    expect(isQuietPath(DOCS_PATH)).toBe(true);
    expect(isQuietPath(COLOR_PICKER_DOCS_PATH)).toBe(true);
    expect(isQuietPath(`${TOASTER_DOCS_PATH}/styling`)).toBe(true);
    expect(isQuietPath('/docsets')).toBe(false);
    expect(isQuietPath(COLOR_PICKER_PATH)).toBe(false);
    expect(isQuietPath(TOASTER_PATH)).toBe(false);
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
