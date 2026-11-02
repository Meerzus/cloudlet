import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REGISTRY_ITEM_URL, SITE_URL, TOASTER_PATH } from '../../apps/site/src/lib/site';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/**
 * The shadcn registry served by the site: `registry:build` writes
 * `registry/r/*.json` and copies them to `apps/site/public/r/`, so `${SITE_URL}/r/toaster.json`
 * is exactly the built item.
 */
describe('site registry (/r)', () => {
  it('serves the built catalog and item unchanged', () => {
    for (const name of ['registry.json', 'toaster.json', 'color-picker.json']) {
      expect(JSON.parse(read(`apps/site/public/r/${name}`)), name).toEqual(JSON.parse(read(`registry/r/${name}`)));
    }
  });

  it('keeps the source out of the catalog, as the shadcn registry index requires', () => {
    const catalog = JSON.parse(read('registry/r/registry.json')) as { items: { name: string; files: object[] }[] };
    expect(catalog.items.map((entry) => entry.name)).toEqual(['toaster', 'color-picker']);
    for (const entry of catalog.items) for (const file of entry.files) expect(file, entry.name).not.toHaveProperty('content');
    for (const name of ['toaster', 'color-picker']) {
      const item = JSON.parse(read(`registry/r/${name}.json`)) as { files: { content?: string }[] };
      expect(item.files.every((file) => typeof file.content === 'string' && file.content.length > 0), name).toBe(true);
    }
  });

  it('serves the color picker exactly as the site runs it (rerun registry:build after editing it)', () => {
    const item = JSON.parse(read('registry/r/color-picker.json')) as { files: { path: string; content: string }[] };
    for (const file of item.files) expect(file.content, file.path).toBe(read(file.path));
  });

  it('is the item the install command names', () => {
    expect(REGISTRY_ITEM_URL).toBe(`${SITE_URL}/r/toaster.json`);
    expect(JSON.parse(read('registry/registry.json')).homepage).toBe(`${SITE_URL}${TOASTER_PATH}`);
  });
});
