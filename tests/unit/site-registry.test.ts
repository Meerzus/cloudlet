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
    for (const name of ['registry.json', 'toaster.json']) {
      expect(JSON.parse(read(`apps/site/public/r/${name}`)), name).toEqual(JSON.parse(read(`registry/r/${name}`)));
    }
  });

  it('is the item the install command names', () => {
    expect(REGISTRY_ITEM_URL).toBe(`${SITE_URL}/r/toaster.json`);
    expect(JSON.parse(read('registry/registry.json')).homepage).toBe(`${SITE_URL}${TOASTER_PATH}`);
  });
});
