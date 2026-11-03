import { createHash, createPublicKey, verify } from 'node:crypto';

function decode(value) {
  const text = value.replace(/\s+/g, '');
  const bytes = Buffer.from(text, 'base64');
  if (!text || bytes.toString('base64') !== text) throw new Error('noncanonical base64');
  return bytes;
}

function publicKeyBytes(publicKey) {
  let text = publicKey;
  try {
    const decoded = decode(text).toString('utf8');
    if (/minisign public key/i.test(decoded)) text = decoded;
  } catch { /* Also accept a bare key line or a two-line public key. */ }
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const bytes = decode(lines.at(-1) || '');
  if (bytes.length !== 42) throw new Error(`pubkey block is ${bytes.length} bytes, expected 42`);
  if (!['Ed', 'ED'].includes(bytes.subarray(0, 2).toString('latin1'))) throw new Error('unknown public key algorithm');
  return bytes;
}

/** Shared updater verification. Callers supply the independently pinned key and exact message. */
export async function verifyTauriSignature(publicKey, signature, readMessage) {
  let keyBytes, sigBytes, trustedComment, globalSignature;
  try {
    keyBytes = publicKeyBytes(publicKey);
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

const UPDATE_FIELDS = [
  'schema', 'artifactSha256', 'policySha256', 'configurationSha256', 'sourceRevision',
  'version', 'product', 'platform', 'authorId', 'approverId', 'approverEpoch',
  'signerId', 'signerEpoch', 'rootEpoch', 'rollbackCounter', 'issuedAt', 'expiresAt',
];
const EXPECTED_UPDATE_FIELDS = [
  'artifactSha256', 'policySha256', 'configurationSha256', 'sourceRevision',
  'version', 'product', 'platform', 'authorId', 'rollbackCounter',
];
const SHA256 = /^[0-9a-f]{64}$/;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 200 &&
  value.trim() === value && !/[\s\x00-\x1f\x7f]/.test(value);

function dataRecord(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && fields.every(field =>
    Object.hasOwn(value, field) && 'value' in Object.getOwnPropertyDescriptor(value, field));
}

/** One byte representation for both the release signature and the independent approval. */
export function encodeTauriUpdateAuthorization(metadata) {
  if (!dataRecord(metadata, UPDATE_FIELDS) || metadata.schema !== 'tauri-update-authorization-v1' ||
      !['artifactSha256', 'policySha256', 'configurationSha256'].every(key =>
        typeof metadata[key] === 'string' && SHA256.test(metadata[key])) ||
      !/^[0-9a-f]{40}$/.test(metadata.sourceRevision) ||
      !['version', 'product', 'platform', 'authorId', 'approverId', 'signerId'].every(key => label(metadata[key])) ||
      !['approverEpoch', 'signerEpoch', 'rootEpoch', 'rollbackCounter', 'issuedAt', 'expiresAt'].every(key => integer(metadata[key])) ||
      metadata.expiresAt <= metadata.issuedAt) {
    throw new Error('invalid update authorization metadata');
  }
  return JSON.stringify(Object.fromEntries(UPDATE_FIELDS.map(key => [key, metadata[key]])));
}

/** Snapshot a canonical envelope without asserting signature or current-trust validity. */
export function parseTauriUpdateEnvelope(envelope) {
  if (!dataRecord(envelope, ['payload', 'signature', 'approvalSignature']) ||
      typeof envelope.payload !== 'string' || envelope.payload.length > 16_384 ||
      !['signature', 'approvalSignature'].every(key =>
        typeof envelope[key] === 'string' && envelope[key].length > 0 && envelope[key].length <= 4096)) {
    throw new Error('invalid signed update envelope');
  }
  const { payload, signature, approvalSignature } = envelope;
  for (const signed of [signature, approvalSignature]) {
    if (decode(signed).toString('utf8').trimEnd().split(/\r?\n/).length !== 4) {
      throw new Error('complete minisign authorization signatures required');
    }
  }
  if (encodeTauriUpdateAuthorization(JSON.parse(payload)) !== payload) {
    throw new Error('noncanonical update payload');
  }
  return { payload, signature, approvalSignature };
}

/**
 * Verify exact reviewed update inputs under independently supplied CURRENT trust state.
 * This does not establish trust roots or advance rollback/freshness state: the installer
 * must read protected state, hash the candidate and its actual policy/config, then commit
 * the new floors atomically with activation. Candidate-supplied keys are never consulted.
 */
export async function verifyTauriUpdateAuthorization(trust, envelope, expected, now) {
  const refused = reason => ({ code: 1, valid: false, reason });
  let metadata, signer, approver, signerBytes, approverBytes, payload, signature, approvalSignature;
  try {
    ({ payload, signature, approvalSignature } = parseTauriUpdateEnvelope(envelope));
    metadata = JSON.parse(payload);
    if (!dataRecord(expected, EXPECTED_UPDATE_FIELDS)) throw new Error('exact candidate inputs required');
    for (const field of EXPECTED_UPDATE_FIELDS) {
      if (metadata[field] !== expected[field]) return refused(`candidate ${field} differs from reviewed update`);
    }
    if (!trust || !integer(now) || !integer(trust.rootEpoch) || !integer(trust.minRollbackCounter) ||
        !integer(trust.minIssuedAt) || !integer(trust.maxMetadataAgeMs) || trust.maxMetadataAgeMs === 0 ||
        !Array.isArray(trust.signers) || trust.signers.length > 64 ||
        !Array.isArray(trust.approvers) || trust.approvers.length > 64) {
      throw new Error('protected update trust state required');
    }
    if (metadata.rootEpoch !== trust.rootEpoch) return refused('update trust root epoch is not current');
    if (metadata.rollbackCounter < trust.minRollbackCounter) return refused('update rollback counter is below the installed floor');
    if (metadata.issuedAt < trust.minIssuedAt || metadata.issuedAt > now ||
        metadata.expiresAt <= now || now - metadata.issuedAt > trust.maxMetadataAgeMs) {
      return refused('update metadata is stale, expired or from the future');
    }
    const selectKey = (keys, id, epoch) => {
      const matches = keys.filter(key => key?.id === id && key?.epoch === epoch);
      if (matches.length !== 1 || matches[0].revoked !== false || !label(matches[0].principalId)) {
        throw new Error('update signer/approver is absent, ambiguous or revoked');
      }
      // Snapshot before any asynchronous verification: a mutable caller object must
      // not substitute a key or identity between the policy and signature checks.
      return { ...matches[0] };
    };
    signer = selectKey(trust.signers, metadata.signerId, metadata.signerEpoch);
    approver = selectKey(trust.approvers, metadata.approverId, metadata.approverEpoch);
    signerBytes = publicKeyBytes(signer.publicKey);
    approverBytes = publicKeyBytes(approver.publicKey);
    if (approver.principalId === metadata.authorId || approver.principalId === signer.principalId ||
        signerBytes.subarray(10).equals(approverBytes.subarray(10))) {
      return refused('update approval is not independent of its author and release signer');
    }
  } catch (error) {
    return { code: 2, valid: false, error: `update authorization: ${error.message}` };
  }
  const bytes = Buffer.from(payload, 'utf8');
  const message = algorithm => algorithm === 'ED' ? createHash('blake2b512').update(bytes).digest() : bytes;
  const releaseResult = await verifyTauriSignature(signer.publicKey, signature, message);
  if (!releaseResult.valid) return refused('update metadata release signature is invalid');
  const approvalResult = await verifyTauriSignature(approver.publicKey, approvalSignature, message);
  if (!approvalResult.valid) return refused('update metadata approval signature is invalid');
  return { code: 0, valid: true, metadata, signerKeyId: releaseResult.keyId, approverKeyId: approvalResult.keyId };
}
