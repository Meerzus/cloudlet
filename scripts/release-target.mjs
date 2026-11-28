import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packageTarballFilename } from './local-candidate.mjs';

/**
 * The packages this repository publishes, in the order they are packed. `key` is the prefix of the
 * release tag (`toast-v1.4.0`), `dir` is relative to the repository root. `latest` says whether a
 * stable release of the package may take the Latest mark of the GitHub repository: only the
 * Toaster does, the agent bridge is an experimental 0.x.
 */
export const PACKAGES = Object.freeze([
  Object.freeze({ key: 'toast', name: '@cloudlet/toast', dir: 'packages/toast', latest: true }),
  Object.freeze({ key: 'agent', name: '@cloudlet/agent', dir: 'packages/agent', latest: false }),
]);

const TAG = /^(toast|agent)-v(\d+\.\d+\.\d+(?:-rc\.\d+)?)$/u;

/**
 * What a release tag releases: `{ key, name, dir, version, distTag, prerelease, latest, tarball,
 * changelog }`. `distTag` is `next` for a prerelease and `latest` otherwise; `latest` is whether
 * the GitHub Release takes the repository's Latest mark; `tarball` is the file name `npm pack`
 * gives; `changelog` is the package's CHANGELOG, relative to the repository root. Throws for any
 * other tag, including the `vX.Y.Z` tags of the Toaster up to 1.3.0.
 */
export function parseReleaseTag(tag) {
  const match = TAG.exec(String(tag));
  if (!match) throw new Error(`release tags are toast-vX.Y.Z or agent-vX.Y.Z, optionally with -rc.N; got "${tag}"`);
  const [, key, version] = match;
  const { name, dir, latest } = PACKAGES.find((entry) => entry.key === key);
  const prerelease = version.includes('-');
  return {
    key,
    name,
    dir,
    version,
    distTag: prerelease ? 'next' : 'latest',
    prerelease,
    latest: latest && !prerelease,
    tarball: packageTarballFilename({ name, version }),
    changelog: `${dir}/CHANGELOG.md`,
  };
}

/** Parses the tag and checks that it names the name and the version of the package's manifest. */
export async function readReleaseTarget(tag, { root }) {
  const target = parseReleaseTag(tag);
  const manifest = JSON.parse(await readFile(resolve(root, target.dir, 'package.json'), 'utf8'));
  if (manifest.name !== target.name) throw new Error(`${target.dir}/package.json is ${manifest.name}, not ${target.name}`);
  if (manifest.version !== target.version) throw new Error(`Tag ${tag} does not match ${target.name} ${manifest.version} in ${target.dir}/package.json`);
  return target;
}

/** `key=value` lines that the release workflow appends to `$GITHUB_OUTPUT` as they are. */
export function formatReleaseTarget(target) {
  return [
    `package=${target.key}`,
    `name=${target.name}`,
    `dir=${target.dir}`,
    `version=${target.version}`,
    `dist-tag=${target.distTag}`,
    `prerelease=${target.prerelease}`,
    `latest=${target.latest}`,
    `tarball=${target.tarball}`,
    `changelog=${target.changelog}`,
  ].join('\n') + '\n';
}

/**
 * `node scripts/release-target.mjs <tag> >> "$GITHUB_OUTPUT"`: fails for a tag of another form or
 * one that does not match the package's manifest, and otherwise prints what the tag releases.
 */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const [tag] = process.argv.slice(2);
  try {
    if (!tag) throw new Error('Usage: node scripts/release-target.mjs <toast-vX.Y.Z | agent-vX.Y.Z>');
    process.stdout.write(formatReleaseTarget(await readReleaseTarget(tag, { root })));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
