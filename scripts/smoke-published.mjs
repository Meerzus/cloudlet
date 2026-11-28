// Checks what npm actually serves after a release, from a clean project and the real registry.
//
//   npm run smoke:published -- [--tag next|latest] [--toast <version>] [--agent <version>]
//                              [--evidence <dir>] [--toast-only]
//
// Full mode (after a prerelease: `--tag next`, both packages):
//   1. `npm view <pkg> dist-tags` — the tag points to the expected version of each package. The
//      expected version is `--toast` / `--agent`, else the version in packages/<dir>/package.json.
//   2. A fresh project under artifacts/smoke-published/<time>/project gets `npm init -y`, then
//      `@cloudlet/toast@<tag>`, `@cloudlet/agent@<tag>`, react and react-dom from
//      https://registry.npmjs.org/ with --ignore-scripts. The installed versions are the expected
//      ones and the lockfile integrity of each equals the registry's `dist.integrity`.
//   3. In Node, from that project: createAgent().connect(toasterAgent(createCloudlet())) — the
//      snapshot shows a notification, act([{ action: 'dismiss' }]) closes it.
//   4. Provenance, two ways: `npm audit signatures` in the project verifies the registry signatures
//      and the attestation bundles (Sigstore) of every installed package; then, for our packages,
//      the registry must list a SLSA v1 provenance attestation whose subject is this name@version
//      with the registry's sha512, built by .github/workflows/release.yml of Meerzus/cloudlet from
//      the tag of that version (toast-vX.Y.Z / agent-vX.Y.Z; vX.Y.Z for the Toaster up to 1.3.0).
//   5. With --evidence <dir> (the `package` artifact of a release run, or artifacts/integration):
//      `npm view <pkg>@<v> dist.shasum dist.integrity` equals <dir>/<key>-evidence.json. A release
//      artifact holds the evidence of its own package only, so a missing file is skipped and said;
//      no evidence for any checked package, or evidence of another version, is an error.
//
// --toast-only checks the Toaster alone (the bridge is not on npm yet): no bridge install and no
// bridge step. When the installed Toaster has the ./agent subpath, its adapter is checked without the
// bridge (protocol 1, the notification in its snapshot); 1.3.0 has none, so that probe is skipped.
//
// It prints a short report, writes smoke.json next to the project, and exits non-zero on any failure.
// It reads from npm only: nothing is published. Not part of CI — run it by hand after a release.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PACKAGES } from './release-target.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'https://registry.npmjs.org/';
const REPOSITORY = 'https://github.com/Meerzus/cloudlet';
const WORKFLOW = '.github/workflows/release.yml';
const SLSA = 'https://slsa.dev/provenance/v1';
const VERSION = /^\d+\.\d+\.\d+(?:-rc\.\d+)?$/;
const USAGE = 'Usage: node scripts/smoke-published.mjs [--tag next|latest] [--toast <version>] [--agent <version>] [--evidence <dir>] [--toast-only]';

export function parseSmokeArgs(argv) {
  const options = { tag: 'next', toast: undefined, agent: undefined, evidence: undefined, toastOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--toast-only') {
      options.toastOnly = true;
      continue;
    }
    const key = { '--tag': 'tag', '--toast': 'toast', '--agent': 'agent', '--evidence': 'evidence' }[flag];
    const value = argv[index + 1];
    if (!key || value === undefined || value.startsWith('--')) throw new Error(`${USAGE}\nUnexpected argument: ${flag}`);
    options[key] = value;
    index += 1;
  }
  if (!['next', 'latest'].includes(options.tag)) throw new Error(`--tag is next or latest, not ${options.tag}`);
  for (const key of ['toast', 'agent']) {
    if (options[key] !== undefined && !VERSION.test(options[key])) throw new Error(`--${key} must be X.Y.Z or X.Y.Z-rc.N, not ${options[key]}`);
  }
  if (options.toastOnly && options.agent !== undefined) throw new Error('--agent has no meaning with --toast-only');
  return options;
}

/** The tag the release pipeline pushes for this version: toast-vX.Y.Z / agent-vX.Y.Z, vX.Y.Z for the Toaster before the switch. */
export function releaseTagsFor(key, version) {
  const tags = [`${key}-v${version}`];
  if (key === 'toast' && /^1\.[0-3]\.\d+(?:-rc\.\d+)?$/.test(version)) tags.push(`v${version}`);
  return tags;
}

/** Checks the registry's attestation bundle list against name@version, its sha512 integrity and the release workflow. */
export function checkProvenance({ name, version, key, integrity, attestations }) {
  const provenance = attestations.find((entry) => entry.predicateType === SLSA);
  assert.ok(provenance, `${name}@${version}: the registry lists no SLSA provenance attestation`);
  const statement = JSON.parse(Buffer.from(provenance.bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
  const sha512 = Buffer.from(integrity.replace(/^sha512-/, ''), 'base64').toString('hex');
  const subject = `pkg:npm/${name.replace('@', '%40')}@${version}`;
  assert.ok(
    statement.subject.some((entry) => entry.name === subject && entry.digest?.sha512 === sha512),
    `${name}@${version}: the provenance subject is not ${subject} with the registry's sha512`,
  );
  const workflow = statement.predicate?.buildDefinition?.externalParameters?.workflow ?? {};
  assert.equal(workflow.repository, REPOSITORY, `${name}@${version}: built from ${workflow.repository}, not ${REPOSITORY}`);
  assert.equal(workflow.path, WORKFLOW, `${name}@${version}: built by ${workflow.path}, not ${WORKFLOW}`);
  const tags = releaseTagsFor(key, version).map((tag) => `refs/tags/${tag}`);
  assert.ok(tags.includes(workflow.ref), `${name}@${version}: built from ${workflow.ref}, expected ${tags.join(' or ')}`);
  const commit = statement.predicate.buildDefinition.resolvedDependencies?.find((entry) => entry.digest?.gitCommit)?.digest.gitCommit;
  return { predicateType: SLSA, ref: workflow.ref, commit };
}

/** Compares the registry's dist fields with a pack evidence file of the same package and version. */
export function checkEvidence({ name, version, dist, evidence, file }) {
  assert.equal(evidence.manifest?.name, name, `${file} describes ${evidence.manifest?.name}, not ${name}`);
  assert.equal(evidence.manifest?.version, version, `${file} describes ${name}@${evidence.manifest?.version}, not ${version}`);
  assert.equal(dist.shasum, evidence.shasum, `${name}@${version}: registry shasum ${dist.shasum} ≠ checked archive ${evidence.shasum} (${file})`);
  assert.equal(dist.integrity, evidence.integrity, `${name}@${version}: registry integrity ≠ checked archive (${file})`);
  return { file, shasum: dist.shasum, integrity: dist.integrity, sha256: evidence.sha256 };
}

function npm(cwd, args, { json = false } = {}) {
  const output = execFileSync('npm', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, npm_config_registry: REGISTRY, npm_config_fund: 'false', npm_config_update_notifier: 'false' },
    maxBuffer: 64 * 1024 * 1024,
  });
  return json ? JSON.parse(output) : output;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export const bridgeProbe = `
import assert from 'node:assert/strict';
import { createAgent } from '@cloudlet/agent';
import { createCloudlet } from '@cloudlet/toast';
import { toasterAgent } from '@cloudlet/toast/agent';
const agent = createAgent();
const controller = createCloudlet();
agent.connect(toasterAgent(controller));
let heard = 0;
agent.subscribe(() => { heard += 1; });
controller.show({ title: 'From npm' });
assert.ok(heard > 0, 'A Toaster change reaches the bridge');
const record = agent.snapshot().find((entry) => entry.ref !== 'toaster');
assert.ok(record, 'The snapshot shows the notification');
assert.ok(record.actions.includes('dismiss'), 'The notification offers dismiss');
const result = await agent.act({ steps: [{ ref: record.ref, action: 'dismiss' }] });
assert.equal(result.ok, true, JSON.stringify(result));
assert.equal(result.steps[0].gone, true, 'The dismiss step closes the notification');
assert.equal(controller.getSnapshot().notifications.length, 0);
controller.dispose();
assert.deepEqual(agent.snapshot(), []);
console.log(JSON.stringify({ ref: record.ref, label: record.label ?? null, act: result }));
`;

export const toastProbe = (withAdapter) => `
import assert from 'node:assert/strict';
import { createCloudlet } from '@cloudlet/toast';
const controller = createCloudlet();
controller.show({ title: 'From npm' });
assert.equal(controller.getSnapshot().notifications.length, 1, 'The controller shows a notification');
let adapter = null;
${withAdapter ? `
const { toasterAgent } = await import('@cloudlet/toast/agent');
const component = toasterAgent(controller);
assert.equal(component.protocol, 1, 'The adapter speaks protocol 1');
const records = component.snapshot();
assert.ok(records.length > 1, 'The adapter snapshot shows the notification');
adapter = { protocol: component.protocol, records: records.length };
` : ''}
controller.dispose();
console.log(JSON.stringify({ notifications: 1, adapter }));
`;

async function runProbe(project, file, source) {
  await writeFile(join(project, file), source);
  const output = execFileSync(process.execPath, [file], { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(output.trim().split('\n').at(-1));
}

export async function smokePublished(options) {
  const selected = PACKAGES.filter((entry) => !(options.toastOnly && entry.key !== 'toast'));
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const outDir = join(root, 'artifacts', 'smoke-published', stamp);
  const project = join(outDir, 'project');
  const report = { schemaVersion: 1, startedAt: new Date().toISOString(), tag: options.tag, toastOnly: options.toastOnly, registry: REGISTRY, packages: {}, steps: [], status: 'failed' };
  const step = async (name, action) => {
    try {
      const detail = await action();
      report.steps.push({ name, ok: true, ...(detail === undefined ? {} : { detail }) });
      console.log(`  ok    ${name}`);
      return detail;
    } catch (error) {
      report.steps.push({ name, ok: false, error: error.message });
      console.log(`  FAIL  ${name}\n        ${error.message.split('\n').join('\n        ')}`);
      throw error;
    }
  };

  await mkdir(project, { recursive: true });
  console.log(`smoke:published — ${selected.map((entry) => `${entry.name}@${options.tag}`).join(', ')} from ${REGISTRY}`);
  try {
    for (const entry of selected) {
      const manifest = await readJson(join(root, entry.dir, 'package.json'));
      const expected = options[entry.key] ?? manifest.version;
      report.packages[entry.key] = { name: entry.name, expected };
      await step(`${entry.name}: dist-tag ${options.tag} → ${expected}`, () => {
        const tags = npm(root, ['view', entry.name, 'dist-tags', '--json'], { json: true });
        report.packages[entry.key].distTags = tags;
        assert.equal(tags[options.tag], expected, `${entry.name}: dist-tag ${options.tag} is ${tags[options.tag] ?? 'missing'}, expected ${expected}`);
        return tags;
      });
    }

    await step('clean project: npm init -y and install from the registry', () => {
      npm(project, ['init', '-y']);
      npm(project, ['install', '--ignore-scripts', '--no-audit', ...selected.map((entry) => `${entry.name}@${options.tag}`), 'react', 'react-dom']);
      return relative(root, project);
    });

    const lock = await readJson(join(project, 'package-lock.json'));
    for (const entry of selected) {
      const record = report.packages[entry.key];
      await step(`${entry.name}: installed ${record.expected}, lockfile integrity = registry`, async () => {
        const installed = await readJson(join(project, 'node_modules', entry.name, 'package.json'));
        assert.equal(installed.version, record.expected, `${entry.name}: installed ${installed.version}, expected ${record.expected}`);
        const dist = npm(root, ['view', `${entry.name}@${record.expected}`, 'dist', '--json'], { json: true });
        const locked = lock.packages[`node_modules/${entry.name}`];
        assert.equal(locked?.integrity, dist.integrity, `${entry.name}: lockfile integrity differs from the registry`);
        record.installed = installed.version;
        record.dist = { shasum: dist.shasum, integrity: dist.integrity, tarball: dist.tarball };
        record.hasAgentSubpath = Boolean(installed.exports?.['./agent']);
        record.attestationsUrl = dist.attestations?.url ?? null;
        return record.dist;
      });
    }

    if (options.toastOnly) {
      const withAdapter = report.packages.toast.hasAgentSubpath;
      report.bridge = { skipped: '--toast-only: the bridge is not installed' };
      report.toast = await step(`Node: @cloudlet/toast from npm${withAdapter ? ' + its ./agent adapter (protocol 1)' : ' (no ./agent subpath in this version: adapter probe skipped)'}`, () =>
        runProbe(project, 'probe-toast.mjs', toastProbe(withAdapter)));
    } else {
      report.bridge = await step('Node: createAgent().connect(toasterAgent(controller)) — snapshot, then act dismiss', () =>
        runProbe(project, 'probe-bridge.mjs', bridgeProbe));
    }

    await step('npm audit signatures: registry signatures and attestations of every installed package', () => {
      const output = npm(project, ['audit', 'signatures']);
      report.auditSignatures = output.trim().split('\n').filter(Boolean);
      return report.auditSignatures;
    });

    for (const entry of selected) {
      const record = report.packages[entry.key];
      await step(`${entry.name}@${record.installed}: SLSA provenance from ${WORKFLOW} at the release tag`, async () => {
        assert.ok(record.attestationsUrl, `${entry.name}@${record.installed}: the registry lists no attestations`);
        const response = await fetch(record.attestationsUrl);
        assert.ok(response.ok, `${record.attestationsUrl}: HTTP ${response.status}`);
        const { attestations } = await response.json();
        record.provenance = checkProvenance({ name: entry.name, version: record.installed, key: entry.key, integrity: record.dist.integrity, attestations });
        return record.provenance;
      });
    }

    if (options.evidence) {
      const evidenceDir = resolve(options.evidence);
      const found = [];
      for (const entry of selected) {
        const record = report.packages[entry.key];
        const file = join(evidenceDir, `${entry.key}-evidence.json`);
        let evidence;
        try {
          evidence = await readJson(file);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          record.evidence = { skipped: `${relative(root, file)} not found` };
          console.log(`  skip  ${entry.name}: no ${entry.key}-evidence.json in ${options.evidence}`);
          continue;
        }
        found.push(entry.key);
        await step(`${entry.name}@${record.installed}: registry shasum and integrity = ${entry.key}-evidence.json`, () => {
          record.evidence = checkEvidence({ name: entry.name, version: record.installed, dist: record.dist, evidence, file: relative(root, file) || file });
          return record.evidence;
        });
      }
      await step('--evidence covers at least one checked package', () => {
        assert.ok(found.length > 0, `${options.evidence} holds no ${selected.map((entry) => `${entry.key}-evidence.json`).join(' or ')}`);
        return found;
      });
    }

    report.status = 'passed';
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    const reportPath = join(outDir, 'smoke.json');
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`smoke:published ${report.status} — ${Object.values(report.packages).map((entry) => `${entry.name}@${entry.installed ?? entry.expected}`).join(', ')}; report ${relative(root, reportPath)}`);
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let options;
  try {
    options = parseSmokeArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  await smokePublished(options);
}
