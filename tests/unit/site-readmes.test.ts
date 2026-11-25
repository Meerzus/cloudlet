import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMPONENTS, DOCS_URL, formatKB, PACKAGE_SIZE, registryCommand, SITE_URL, TOASTER_DOCS_PATH } from '../../apps/site/src/lib/site';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/** The English, public face of the repository. */
const PUBLIC = ['README.md', 'packages/toast/README.md', 'CHANGELOG.md', 'packages/toast/CHANGELOG.md'];

describe('READMEs and changelog', () => {
  it('point to the site documentation, not to the package README', () => {
    const expected = { 'README.md': DOCS_URL, 'packages/toast/README.md': `${SITE_URL}${TOASTER_DOCS_PATH}` };
    for (const [path, url] of Object.entries(expected)) {
      expect(read(path), `${path} links ${url}`).toContain(url);
      expect(read(path), path).not.toContain('packages/toast#readme');
    }
  });

  it('are written in English', () => {
    for (const path of PUBLIC) expect(read(path), path).not.toMatch(/\p{Script=Cyrillic}/u);
  });

  it('ship the same changelog in the package as in the repository', () => {
    expect(read('packages/toast/CHANGELOG.md')).toBe(read('CHANGELOG.md'));
  });

  it('print the measured first-load size in the package README size badge', () => {
    const badge = `min%2Bgzip-${encodeURIComponent(`${formatKB(PACKAGE_SIZE.start)} first load`)}-`;
    expect(read('packages/toast/README.md')).toContain(badge);
  });

  it('introduce every component of the kit in the root README: its landing, its docs and its install command', () => {
    const readme = read('README.md');
    for (const component of COMPONENTS) {
      expect(readme, component.name).toContain(`](${SITE_URL}${component.path})`);
      expect(readme, component.name).toContain(`](${SITE_URL}${component.docs})`);
      expect(readme, component.name).toContain(registryCommand(component.id));
    }
  });

  it('keep the rc.0 migration notes in the changelog', () => {
    expect(read('CHANGELOG.md')).toContain('### Migrating from 1.0.0-rc.0');
    expect(read('packages/toast/README.md')).not.toContain('Migrating from');
  });
});
