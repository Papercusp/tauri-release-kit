export interface TauriSignatureResult {
  code: 0 | 1 | 2;
  valid: boolean;
  error?: string;
  reason?: string;
  algo?: 'ED' | 'Ed';
  keyId?: string;
}
export function verifyTauriSignature(
  publicKey: string,
  signature: string,
  readMessage: (algorithm: 'ED' | 'Ed') => Uint8Array | Promise<Uint8Array>,
): Promise<TauriSignatureResult>;

export interface TauriUpdateAuthorization {
  schema: 'tauri-update-authorization-v1';
  artifactSha256: string;
  policySha256: string;
  configurationSha256: string;
  sourceRevision: string;
  version: string;
  product: string;
  platform: string;
  authorId: string;
  approverId: string;
  approverEpoch: number;
  signerId: string;
  signerEpoch: number;
  rootEpoch: number;
  rollbackCounter: number;
  issuedAt: number;
  expiresAt: number;
}
export interface TauriUpdateTrustKey {
  id: string;
  epoch: number;
  principalId: string;
  publicKey: string;
  revoked: boolean;
}
export interface TauriUpdateTrust {
  rootEpoch: number;
  minRollbackCounter: number;
  minIssuedAt: number;
  maxMetadataAgeMs: number;
  signers: readonly TauriUpdateTrustKey[];
  approvers: readonly TauriUpdateTrustKey[];
}
export type TauriUpdateCandidate = Pick<TauriUpdateAuthorization,
  'artifactSha256' | 'policySha256' | 'configurationSha256' | 'sourceRevision' |
  'version' | 'product' | 'platform' | 'authorId' | 'rollbackCounter'>;
export interface TauriUpdateEnvelope {
  payload: string;
  signature: string;
  approvalSignature: string;
}
/** Structural/canonical validation only; does not authenticate or authorize activation. */
export function parseTauriUpdateEnvelope(envelope: unknown): TauriUpdateEnvelope;
export function encodeTauriUpdateAuthorization(metadata: TauriUpdateAuthorization): string;
export function verifyTauriUpdateAuthorization(
  trust: TauriUpdateTrust,
  envelope: TauriUpdateEnvelope,
  expected: TauriUpdateCandidate,
  now: number,
): Promise<{
  code: 0 | 1 | 2;
  valid: boolean;
  reason?: string;
  error?: string;
  metadata?: TauriUpdateAuthorization;
  signerKeyId?: string;
  approverKeyId?: string;
}>;
