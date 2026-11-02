import { createPublicKey, verify } from 'node:crypto';

function decode(value) {
  const text = value.replace(/\s+/g, '');
  const bytes = Buffer.from(text, 'base64');
  if (!text || bytes.toString('base64') !== text) throw new Error('noncanonical base64');
  return bytes;
}

/** Shared updater verification. Callers supply the independently pinned key and exact message. */
export async function verifyTauriSignature(publicKey, signature, readMessage) {
  let keyBytes, sigBytes, trustedComment, globalSignature;
  try {
    let text = publicKey;
    try {
      const decoded = decode(text).toString('utf8');
      if (/minisign public key/i.test(decoded)) text = decoded;
    } catch { /* A bare key line or a two-line public key is also supported. */ }
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    keyBytes = decode(lines.at(-1) || '');
    const sigLines = decode(signature).toString('utf8').split(/\r?\n/);
    while (sigLines.at(-1) === '') sigLines.pop();
    if (sigLines.length !== 2 && sigLines.length !== 4) {
      throw new Error('expected an artifact signature or a complete trusted-comment signature');
    }
    sigBytes = decode(sigLines[1]);
    if (sigLines.length === 4) {
      if (!sigLines[2].startsWith('trusted comment: ')) throw new Error('missing trusted comment prefix');
      trustedComment = sigLines[2].slice('trusted comment: '.length);
      globalSignature = decode(sigLines[3]);
      if (globalSignature.length !== 64) throw new Error('global signature must contain 64 bytes');
    }
    if (keyBytes.length !== 42) throw new Error(`pubkey block is ${keyBytes.length} bytes, expected 42`);
    if (sigBytes.length !== 74) throw new Error(`sig block is ${sigBytes.length} bytes, expected 74`);
  } catch (error) {
    return { code: 2, valid: false, error: `parse error: ${error.message}` };
  }
  const keyId = keyBytes.subarray(2, 10).toString('hex');
  if (!keyBytes.subarray(2, 10).equals(sigBytes.subarray(2, 10))) {
    return { code: 1, valid: false, reason: 'key id mismatch (signature not from this key)', keyId };
  }
  const algo = sigBytes.subarray(0, 2).toString('latin1');
  if (algo !== 'ED' && algo !== 'Ed') {
    return { code: 2, valid: false, error: `unknown signature algorithm '${algo}'` };
  }
  try {
    const key = createPublicKey({ key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'), keyBytes.subarray(10),
    ]), format: 'der', type: 'spki' });
    const sig = sigBytes.subarray(10);
    if (!verify(null, await readMessage(algo), key, sig)) {
      return { code: 1, valid: false, reason: 'ed25519 signature does not verify against the pubkey', algo, keyId };
    }
    if (globalSignature && !verify(null,
      Buffer.concat([sig, Buffer.from(trustedComment, 'utf8')]), key, globalSignature)) {
      return { code: 1, valid: false, reason: 'global signature does not verify against the trusted comment', algo, keyId };
    }
    return { code: 0, valid: true, algo, keyId };
  } catch (error) {
    return { code: 1, valid: false, reason: `verify error: ${error.message}`, algo, keyId };
  }
}
