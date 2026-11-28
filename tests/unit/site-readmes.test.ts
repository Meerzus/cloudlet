import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMPONENTS, DOCS_URL, registryCommand, SITE_URL, TOASTER_DOCS_PATH } from '../../apps/site/src/lib/site';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/** The English, public face of the repository. */
const PUBLIC = ['README.md', 'packages/toast/README.md', 'CHANGELOG.md', 'packages/toast/CHANGELOG.md', 'packages/agent/README.md', 'packages/agent/CHANGELOG.md'];

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

  it('keep one changelog per package and point to each of them from the root', () => {
    const root = read('CHANGELOG.md');
    for (const path of ['packages/toast/CHANGELOG.md', 'packages/agent/CHANGELOG.md', 'apps/site/CHANGELOG.md']) {
      expect(root, path).toContain(`](${path})`);
    }
    expect(root).toContain('toast-vX.Y.Z');
    expect(root).toContain('agent-vX.Y.Z');
    expect(root, 'the root changelog holds no release sections').not.toMatch(/^## /mu);
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
    expect(read('packages/toast/CHANGELOG.md')).toContain('### Migrating from 1.0.0-rc.0');
    expect(read('packages/toast/README.md')).not.toContain('Migrating from');
  });
});
