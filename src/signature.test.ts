import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeTauriUpdateAuthorization, verifyTauriSignature, verifyTauriUpdateAuthorization,
  type TauriUpdateAuthorization, type TauriUpdateCandidate, type TauriUpdateTrust } from './signature.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(algo: 'ED' | 'Ed', full = true) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const id = Buffer.from('0123456789abcdef', 'hex');
  const raw = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32);
  const key = `untrusted comment: minisign public key\n${Buffer.concat([Buffer.from('Ed'), id, raw]).toString('base64')}\n`;
  const bytes = Buffer.from('literal signed artifact\n');
  const message = algo === 'ED' ? createHash('blake2b512').update(bytes).digest() : bytes;
  const sig = sign(null, message, privateKey);
  const block = Buffer.concat([Buffer.from(algo), id, sig]).toString('base64');
  const comment = 'timestamp:42 file:fixture';
  const global = sign(null, Buffer.concat([sig, Buffer.from(comment)]), privateKey).toString('base64');
  const text = `untrusted comment: fixture\n${block}\n${full ? `trusted comment: ${comment}\n${global}\n` : ''}`;
  return { key, encodedKey: Buffer.from(key).toString('base64'), bytes, message, signature: Buffer.from(text).toString('base64'), text };
}

describe('shared updater signature verifier', () => {
  it.each(['ED', 'Ed'] as const)('verifies real %s signatures, both key encodings and legacy/full envelopes', async algo => {
    for (const full of [true, false]) {
      const f = fixture(algo, full);
      for (const key of [f.key, f.encodedKey]) {
        await expect(verifyTauriSignature(key, f.signature, () => f.message)).resolves.toMatchObject({ code: 0, valid: true, algo });
      }
      await expect(verifyTauriSignature(f.key, f.signature, () => Buffer.from('tampered')))
        .resolves.toMatchObject({ code: 1, valid: false });
    }
  });
  it('rejects a changed trusted comment despite a valid artifact signature', async () => {
    const f = fixture('ED');
    const signature = Buffer.from(f.text.replace('timestamp:42', 'timestamp:43')).toString('base64');
    await expect(verifyTauriSignature(f.key, signature, () => f.message))
      .resolves.toMatchObject({ code: 1, valid: false, reason: expect.stringContaining('trusted comment') });
  });
  it('rejects malformed keys before reading and rejects a different key even with the same key id', async () => {
    const f = fixture('ED');
    const read = vi.fn(() => f.message);
    await expect(verifyTauriSignature('broken', f.signature, read)).resolves.toMatchObject({ code: 2, valid: false });
    const other = fixture('ED');
    await expect(verifyTauriSignature(other.key, f.signature, read)).resolves.toMatchObject({ code: 1, valid: false });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it.each(['ED', 'Ed'] as const)('keeps the release CLI compatible with real %s signatures and exit codes', algo => {
    const f = fixture(algo);
    const root = mkdtempSync(join(tmpdir(), 'release-signature-')); roots.push(root);
    const artifact = join(root, 'artifact'); const signature = join(root, 'artifact.sig'); const key = join(root, 'key.pub');
    writeFileSync(artifact, f.bytes); writeFileSync(signature, f.signature); writeFileSync(key, f.key);
    const cli = fileURLToPath(new URL('../../../../papercusp-desktop/bin/verify-tauri-signature.mjs', import.meta.url));
    const run = () => spawnSync(process.execPath, [cli, key, artifact, signature, '--json'], { encoding: 'utf8', env: {}, timeout: 10_000 });
    const accepted = run(); expect(accepted.status, accepted.stderr).toBe(0); expect(JSON.parse(accepted.stdout).valid).toBe(true);
    writeFileSync(artifact, 'tampered'); const refused = run();
    expect(refused.status, refused.stderr).toBe(1); expect(JSON.parse(refused.stdout).valid).toBe(false);
  });
});

function authorizationFixture() {
  const key = (id: string, principalId: string) => {
    const pair = generateKeyPairSync('ed25519');
    const raw = (pair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32);
    const keyId = createHash('sha256').update(id).digest().subarray(0, 8);
    const publicKey = `untrusted comment: minisign public key\n${Buffer.concat([Buffer.from('Ed'), keyId, raw]).toString('base64')}\n`;
    return { id, epoch: 2, principalId, publicKey, revoked: false,
      sign: (payload: string, algorithm: 'ED' | 'Ed' = 'ED') => {
        const bytes = Buffer.from(payload);
        const message = algorithm === 'ED' ? createHash('blake2b512').update(bytes).digest() : bytes;
        const signature = sign(null, message, pair.privateKey);
        return Buffer.from(`untrusted comment: update\n${Buffer.concat([Buffer.from(algorithm), keyId, signature]).toString('base64')}\n`).toString('base64');
      } };
  };
  const signer = key('release', 'release-principal');
  const approver = key('reviewer', 'reviewer-principal');
  const metadata: TauriUpdateAuthorization = {
    schema: 'tauri-update-authorization-v1', artifactSha256: 'a'.repeat(64), policySha256: 'b'.repeat(64),
    configurationSha256: 'c'.repeat(64), sourceRevision: 'd'.repeat(40), version: '1.2.3',
    product: 'gui', platform: 'linux-x86_64', authorId: 'author-principal',
    approverId: approver.id, approverEpoch: approver.epoch, signerId: signer.id, signerEpoch: signer.epoch,
    rootEpoch: 3, rollbackCounter: 7, issuedAt: 1000, expiresAt: 3000,
  };
  const trust: TauriUpdateTrust = { rootEpoch: 3, minRollbackCounter: 7, minIssuedAt: 1000,
    maxMetadataAgeMs: 1500, signers: [signer], approvers: [approver] };
  const candidate: TauriUpdateCandidate = Object.fromEntries([
    'artifactSha256', 'policySha256', 'configurationSha256', 'sourceRevision',
    'version', 'product', 'platform', 'authorId', 'rollbackCounter',
  ].map(field => [field, metadata[field as keyof TauriUpdateAuthorization]])) as unknown as TauriUpdateCandidate;
  const envelope = (payload = encodeTauriUpdateAuthorization(metadata)) =>
    ({ payload, signature: signer.sign(payload), approvalSignature: approver.sign(payload) });
  return { signer, approver, metadata, trust, candidate, envelope };
}

describe('exact independently approved update authorization', () => {
  it('accepts authentic signatures over the exact artifact, reviewed metadata and current trust epoch', async () => {
    const f = authorizationFixture();
    const envelope = f.envelope();
    envelope.approvalSignature = f.approver.sign(envelope.payload, 'Ed');
    const result = await verifyTauriUpdateAuthorization(f.trust, envelope, f.candidate, 2000);
    expect(result).toMatchObject({ code: 0, valid: true, metadata: f.metadata });
    expect(result.signerKeyId).not.toBe(result.approverKeyId);
  });

  it.each([
    ['artifactSha256', 'e'.repeat(64)], ['policySha256', 'e'.repeat(64)],
    ['configurationSha256', 'e'.repeat(64)], ['sourceRevision', 'e'.repeat(40)],
    ['version', '1.2.2'], ['product', 'server'], ['platform', 'windows-x86_64'],
    ['authorId', 'another-author'], ['rollbackCounter', 6],
  ] as const)('refuses an otherwise correctly signed update for different actual %s', async (field, value) => {
    const f = authorizationFixture();
    const result = await verifyTauriUpdateAuthorization(f.trust, f.envelope(), { ...f.candidate, [field]: value }, 2000);
    expect(result).toMatchObject({ valid: false, reason: expect.stringContaining(field) });
  });

  it.each(['signature', 'approvalSignature'] as const)('refuses metadata altered after %s was obtained', async field => {
    const f = authorizationFixture();
    const original = f.envelope();
    f.metadata.version = '1.2.4'; f.candidate.version = '1.2.4';
    const altered = f.envelope(); altered[field] = original[field];
    expect(await verifyTauriUpdateAuthorization(f.trust, altered, f.candidate, 2000))
      .toMatchObject({ valid: false, reason: expect.stringContaining('signature') });
  });

  it.each(['signers', 'approvers'] as const)('refuses a once-authorized but now revoked %s key', async field => {
    const f = authorizationFixture();
    const envelope = f.envelope();
    const trust = { ...f.trust, [field]: f.trust[field].map(key => ({ ...key, revoked: true })) };
    expect(await verifyTauriUpdateAuthorization(trust, envelope, f.candidate, 2000)).toMatchObject({ valid: false });
  });

  it.each(['signers', 'approvers'] as const)('refuses stale or ambiguous %s epochs', async field => {
    const f = authorizationFixture();
    const envelope = f.envelope();
    for (const keys of [f.trust[field].map(key => ({ ...key, epoch: key.epoch + 1 })), [...f.trust[field], ...f.trust[field]]]) {
      expect(await verifyTauriUpdateAuthorization({ ...f.trust, [field]: keys }, envelope, f.candidate, 2000))
        .toMatchObject({ valid: false });
    }
  });

  it.each([
    { rootEpoch: 4 }, { minRollbackCounter: 8 }, { minIssuedAt: 1001 }, { maxMetadataAgeMs: 999 },
  ])('refuses a signed update excluded by current protected state %j', async changed => {
    const f = authorizationFixture();
    expect(await verifyTauriUpdateAuthorization({ ...f.trust, ...changed }, f.envelope(), f.candidate, 2000))
      .toMatchObject({ valid: false });
  });

  it.each([999, 3000, 3001])('refuses future or expired metadata at time %d', async now => {
    const f = authorizationFixture();
    expect(await verifyTauriUpdateAuthorization(f.trust, f.envelope(), f.candidate, now)).toMatchObject({ valid: false });
  });

  it.each(['author-principal', 'release-principal'])('refuses approval by %s under a different key', async principalId => {
    const f = authorizationFixture();
    f.approver.principalId = principalId;
    expect(await verifyTauriUpdateAuthorization(f.trust, f.envelope(), f.candidate, 2000))
      .toMatchObject({ valid: false, reason: expect.stringContaining('not independent') });
  });

  it('refuses the same Ed25519 key disguised as a different approver identity/key id/encoding', async () => {
    const f = authorizationFixture();
    const raw = Buffer.from(f.signer.publicKey.trim().split('\n').at(-1)!, 'base64');
    raw.fill(9, 2, 10);
    f.approver.publicKey = Buffer.from(`untrusted comment: minisign public key\n${raw.toString('base64')}\n`).toString('base64');
    expect(await verifyTauriUpdateAuthorization(f.trust, f.envelope(), f.candidate, 2000))
      .toMatchObject({ valid: false, reason: expect.stringContaining('not independent') });
  });

  it('refuses noncanonical, duplicate-field and extra-field metadata even with authentic signatures', async () => {
    const f = authorizationFixture();
    const payload = encodeTauriUpdateAuthorization(f.metadata);
    for (const altered of [JSON.stringify(f.metadata, null, 2), payload.replace('{', '{"version":"old",'),
      JSON.stringify({ ...f.metadata, extra: 'unsigned semantic input' })]) {
      expect(await verifyTauriUpdateAuthorization(f.trust, f.envelope(altered), f.candidate, 2000))
        .toMatchObject({ code: 2, valid: false });
    }
  });

  it('rejects missing protected state and accessor inputs without evaluating them', async () => {
    const f = authorizationFixture();
    const getter = vi.fn(() => f.metadata.version);
    Object.defineProperty(f.metadata, 'version', { get: getter });
    expect(() => encodeTauriUpdateAuthorization(f.metadata)).toThrow('invalid update');
    expect(getter).not.toHaveBeenCalled();
    const clean = authorizationFixture();
    expect(await verifyTauriUpdateAuthorization({ ...clean.trust, maxMetadataAgeMs: 0 }, clean.envelope(), clean.candidate, 2000))
      .toMatchObject({ code: 2, valid: false });
  });
});
