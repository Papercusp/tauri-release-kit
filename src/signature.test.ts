import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyTauriSignature } from './signature.mjs';

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
