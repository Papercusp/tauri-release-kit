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
