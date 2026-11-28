import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkEvidence, checkProvenance, parseSmokeArgs, releaseTagsFor } from '../../scripts/smoke-published.mjs';

const integrity = `sha512-${Buffer.from('a'.repeat(64)).toString('base64')}`;
const sha512 = Buffer.from('a'.repeat(64)).toString('hex');

function attestation({ name = '@cloudlet/agent', version = '0.1.0-rc.1', digest = sha512, ref = 'refs/tags/agent-v0.1.0-rc.1', repository = 'https://github.com/Meerzus/cloudlet', path = '.github/workflows/release.yml' } = {}) {
  const statement = {
    subject: [{ name: `pkg:npm/${name.replace('@', '%40')}@${version}`, digest: { sha512: digest } }],
    predicate: {
      buildDefinition: {
        externalParameters: { workflow: { ref, repository, path } },
        resolvedDependencies: [{ uri: `git+${repository}@${ref}`, digest: { gitCommit: 'f'.repeat(40) } }],
      },
    },
  };
  return [
    { predicateType: 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1', bundle: {} },
    { predicateType: 'https://slsa.dev/provenance/v1', bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString('base64') } } },
  ];
}

test('smoke arguments: next by default, both packages, versions and tags checked', () => {
  assert.deepEqual(parseSmokeArgs([]), { tag: 'next', toast: undefined, agent: undefined, evidence: undefined, toastOnly: false });
  assert.deepEqual(parseSmokeArgs(['--tag', 'latest', '--toast-only', '--toast', '1.3.0', '--evidence', 'artifacts/integration']), {
    tag: 'latest', toast: '1.3.0', agent: undefined, evidence: 'artifacts/integration', toastOnly: true,
  });
  assert.equal(parseSmokeArgs(['--agent', '0.1.0-rc.1']).agent, '0.1.0-rc.1');
  assert.throws(() => parseSmokeArgs(['--tag', 'beta']), /next or latest/);
  assert.throws(() => parseSmokeArgs(['--toast', '1.4']), /X\.Y\.Z/);
  assert.throws(() => parseSmokeArgs(['--toast-only', '--agent', '0.1.0']), /--toast-only/);
  assert.throws(() => parseSmokeArgs(['--evidence']), /Unexpected argument/);
  assert.throws(() => parseSmokeArgs(['--tarball', 'x.tgz']), /Unexpected argument/);
});

test('release tags of a version: the package tag, and vX.Y.Z for the Toaster up to 1.3', () => {
  assert.deepEqual(releaseTagsFor('toast', '1.3.0'), ['toast-v1.3.0', 'v1.3.0']);
  assert.deepEqual(releaseTagsFor('toast', '1.4.0-rc.1'), ['toast-v1.4.0-rc.1']);
  assert.deepEqual(releaseTagsFor('agent', '0.1.0'), ['agent-v0.1.0']);
});

test('provenance: SLSA statement for this name, version and sha512, built by the release workflow at the release tag', () => {
  const base = { name: '@cloudlet/agent', version: '0.1.0-rc.1', key: 'agent', integrity };
  assert.deepEqual(checkProvenance({ ...base, attestations: attestation() }), {
    predicateType: 'https://slsa.dev/provenance/v1', ref: 'refs/tags/agent-v0.1.0-rc.1', commit: 'f'.repeat(40),
  });
  assert.throws(() => checkProvenance({ ...base, attestations: attestation().slice(0, 1) }), /no SLSA provenance/);
  assert.throws(() => checkProvenance({ ...base, attestations: attestation({ digest: 'b'.repeat(128) }) }), /sha512/);
  assert.throws(() => checkProvenance({ ...base, attestations: attestation({ version: '0.1.0' }) }), /subject/);
  assert.throws(() => checkProvenance({ ...base, attestations: attestation({ repository: 'https://github.com/someone/fork' }) }), /built from/);
  assert.throws(() => checkProvenance({ ...base, attestations: attestation({ path: '.github/workflows/other.yml' }) }), /built by/);
  assert.throws(() => checkProvenance({ ...base, attestations: attestation({ ref: 'refs/heads/main' }) }), /expected refs\/tags\/agent-v0\.1\.0-rc\.1/);
});

test('evidence: the registry shasum and integrity equal the checked archive of the same version', () => {
  const evidence = { manifest: { name: '@cloudlet/toast', version: '1.4.0-rc.1' }, shasum: 'abc', integrity, sha256: 'def' };
  const base = { name: '@cloudlet/toast', version: '1.4.0-rc.1', file: 'toast-evidence.json' };
  assert.deepEqual(checkEvidence({ ...base, evidence, dist: { shasum: 'abc', integrity } }), { file: 'toast-evidence.json', shasum: 'abc', integrity, sha256: 'def' });
  assert.throws(() => checkEvidence({ ...base, evidence, dist: { shasum: 'xyz', integrity } }), /registry shasum xyz ≠ checked archive abc/);
  assert.throws(() => checkEvidence({ ...base, evidence, dist: { shasum: 'abc', integrity: 'sha512-other' } }), /integrity/);
  assert.throws(() => checkEvidence({ ...base, version: '1.4.0', evidence, dist: { shasum: 'abc', integrity } }), /describes @cloudlet\/toast@1\.4\.0-rc\.1, not 1\.4\.0/);
  assert.throws(() => checkEvidence({ ...base, name: '@cloudlet/agent', evidence, dist: { shasum: 'abc', integrity } }), /describes @cloudlet\/toast, not @cloudlet\/agent/);
});
