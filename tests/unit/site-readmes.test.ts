import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCS_URL, formatKB, PACKAGE_SIZE, SITE_URL, TOASTER_PATH } from '../../apps/site/src/lib/site';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/** The English, public face of the repository. */
const PUBLIC = ['README.md', 'packages/toast/README.md', 'CHANGELOG.md', 'packages/toast/CHANGELOG.md'];

describe('READMEs and changelog', () => {
  it('point to the site documentation, not to the package README', () => {
    // Transitional: the READMEs may still name the Toaster's former docs address, which redirects to the new tree.
    const FORMER_DOCS_URL = `${SITE_URL}${TOASTER_PATH}/docs`;
    for (const path of ['README.md', 'packages/toast/README.md']) {
      expect([DOCS_URL, FORMER_DOCS_URL].some((url) => read(path).includes(url)), `${path} links ${DOCS_URL}`).toBe(true);
      expect(read(path), path).not.toContain('packages/toast#readme');
    }
  });

  it('are written in English', () => {
    for (const path of PUBLIC) expect(read(path), path).not.toMatch(/\p{Script=Cyrillic}/u);
  });

  it('ship the same changelog in the package as in the repository', () => {
    expect(read('packages/toast/CHANGELOG.md')).toBe(read('CHANGELOG.md'));
  });

  it('print the measured first-load size in the size badge', () => {
    const badge = `min%2Bgzip-${encodeURIComponent(`${formatKB(PACKAGE_SIZE.start)} first load`)}-`;
    for (const path of ['README.md', 'packages/toast/README.md']) expect(read(path), path).toContain(badge);
  });

  it('keep the rc.0 migration notes in the changelog', () => {
    expect(read('CHANGELOG.md')).toContain('### Migrating from 1.0.0-rc.0');
    expect(read('packages/toast/README.md')).not.toContain('Migrating from');
  });
});
