import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { PACKAGES, parseReleaseTag } from '../../scripts/release-target.mjs';

// The release workflow cannot run outside GitHub, and a mistake in it shows up on the release day,
// when a re-run uses the file of the tagged commit. These checks hold its invariants as plain text.
const root = resolve(import.meta.dirname, '../..');
const workflow = await readFile(resolve(root, '.github/workflows/release.yml'), 'utf8');
const lines = workflow.split('\n');

/** The text of a top-level job, from its `  name:` line to the next job. */
function job(name) {
  const start = lines.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `release.yml has no job ${name}`);
  const end = lines.findIndex((line, index) => index > start && /^ {2}\S/u.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/** The `run:` commands of a job's steps, in order. */
function runs(text) {
  return [...text.matchAll(/^(?: {6}- | {8})run: (.+)$/gmu)].map(([, command]) => command);
}

const verify = job('verify');
const publish = job('publish');

test('only the two package tag patterns trigger a release', () => {
  const triggers = [...workflow.matchAll(/^ {4}tags: (.+)$/gmu)].map(([, value]) => value);
  assert.deepEqual(triggers, [`[${PACKAGES.map(({ key }) => `'${key}-v*'`).join(', ')}]`]);
  assert.deepEqual(triggers, ["['toast-v*', 'agent-v*']"]);
  assert.doesNotMatch(workflow, /^\s+branches:/mu);
});

test('each package has its own release queue that never cancels a release in progress', () => {
  assert.match(workflow, /^ {2}group: release-\$\{\{ startsWith\(github\.ref_name, 'agent-v'\) && 'agent' \|\| 'toast' \}\}$/mu);
  assert.match(workflow, /^ {2}cancel-in-progress: false$/mu);
});

test('verify reads the tag right after installing npm, before anything is installed or built', () => {
  const commands = runs(verify);
  assert.equal(commands[0], 'npm install --global npm@11.12.1');
  assert.equal(commands[1], 'node scripts/release-target.mjs "$GITHUB_REF_NAME" >> "$GITHUB_OUTPUT"');
  assert.equal(commands[2], 'node scripts/release-notes.mjs "$GITHUB_REF_NAME" > /dev/null');
  assert.match(verify, /- id: target\n {8}run: node scripts\/release-target\.mjs/u);
  assert.ok(commands.indexOf('npm ci') > 2);
  for (const output of ['package', 'version', 'dist-tag', 'prerelease', 'latest', 'tarball']) {
    assert.match(verify, new RegExp(`^ {6}${output}: \\$\\{\\{ steps\\.target\\.outputs\\.${output} \\}\\}$`, 'mu'));
  }
});

test('verify keeps the main and CI gates and checks both archives', () => {
  assert.match(verify, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/u);
  assert.match(verify, /gh run watch "\$run" --repo "\$GITHUB_REPOSITORY" --exit-status/u);
  assert.match(verify, /npm run check:package --\n\s+--tarball "artifacts\/integration\/cloudlet-toast-[^\n]+\n\s+--agent-tarball "artifacts\/integration\/cloudlet-agent-/u);
});

test('the uploaded artifact is the tagged package archive and its evidence, and nothing else', () => {
  const upload = verify.slice(verify.indexOf('actions/upload-artifact'));
  assert.match(upload, /if-no-files-found: error/u);
  const paths = [...upload.matchAll(/^ {12}(\S.*)$/gmu)].map(([, path]) => path);
  assert.deepEqual(paths, [
    'artifacts/integration/${{ steps.target.outputs.tarball }}',
    'artifacts/integration/${{ steps.target.outputs.package }}-evidence.json',
  ]);
  assert.doesNotMatch(workflow, /package-evidence\.json/u);
});

test('publish takes the archive name and dist-tag from verify and publishes with provenance', () => {
  assert.match(publish, /^ {6}TARBALL: \$\{\{ needs\.verify\.outputs\.tarball \}\}$/mu);
  assert.match(publish, /^ {6}DIST_TAG: \$\{\{ needs\.verify\.outputs\.dist-tag \}\}$/mu);
  const [command, ...others] = runs(publish).filter((line) => line.startsWith('npm publish'));
  assert.deepEqual(others, []);
  // The leading ./ keeps npm from reading package/<file> as a GitHub shorthand.
  assert.equal(command, 'npm publish "./package/$TARBALL" --access public --tag "$DIST_TAG" --provenance --ignore-scripts');
  // No archive name is spelled out where the tagged package's archive is meant.
  assert.doesNotMatch(publish, /cloudlet-(toast|agent)/u);
  assert.doesNotMatch(workflow, /\$VERSION/u);
});

test('only publish can mint an OIDC token, and the bootstrap token reaches only the publish step', () => {
  assert.match(publish, /^ {6}id-token: write$/mu);
  assert.match(publish, /^ {4}environment: npm$/mu);
  assert.doesNotMatch(verify, /id-token/u);
  assert.equal(workflow.match(/secrets\./gu).length, 1);
  assert.match(publish, /--ignore-scripts\n {8}env:\n {10}NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}\n/u);
});

test('the GitHub Release takes Latest only for a stable Toaster release', () => {
  assert.match(publish, /^ {10}PRERELEASE: \$\{\{ needs\.verify\.outputs\.prerelease \}\}$/mu);
  assert.match(publish, /^ {10}LATEST: \$\{\{ needs\.verify\.outputs\.latest \}\}$/mu);
  assert.match(publish, /flags=\("--latest=\$LATEST"\)/u);
  assert.match(publish, /if \[ "\$PRERELEASE" = "true" \]; then flags\+=\(--prerelease\); fi/u);
  assert.match(publish, /gh release create "\$GITHUB_REF_NAME" "\.\/package\/\$TARBALL" \\\n\s+--verify-tag --title "\$GITHUB_REF_NAME" --notes-file release-notes\.md "\$\{flags\[@\]\}"/u);
  // What the outputs carry: --latest=false for every agent-v… tag and for prereleases.
  assert.equal(parseReleaseTag('toast-v1.4.0').latest, true);
  for (const tag of ['toast-v1.4.0-rc.1', 'agent-v0.1.0', 'agent-v0.1.0-rc.1', 'agent-v1.0.0']) {
    assert.equal(parseReleaseTag(tag).latest, false, tag);
  }
});
