import {
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';

export type SigningAlgorithm = 'ed25519' | 'rsa-sha256';

/**
 * Serializes `value` to canonical JSON per CLAUDE.md §4.5:
 *   - Object keys sorted lexicographically (recursively)
 *   - No whitespace
 *   - UTF-8
 *   - Arrays preserve insertion order
 *
 * The output is the byte sequence the signer signs and the verifier
 * verifies. Two implementations producing the same record MUST produce
 * the same canonical bytes — the cross-implementation contract.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('canonicalize: non-finite numbers are not representable');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k]))
        .join(',') +
      '}'
    );
  }
  throw new Error(`canonicalize: unsupported type ${typeof value}`);
}

/**
 * Generates a 32-byte cryptographically random nonce as 64-char hex.
 * Used by the registration challenge flow (POST /api/v1/register).
 */
export function generateChallengeNonce(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Signs the canonical-JSON projection of `record` using the GARR root
 * private key (ed25519 in v1; CLAUDE.md "v1 simplifications").
 *
 * Strips `signature_value` from the record before serialization — the
 * signature must never sign over itself.
 *
 * @returns base64-encoded signature
 */
export function signCanonical(
  record: Record<string, unknown>,
  privateKeyPem: string,
): string {
  const { signature_value: _strip, ...payload } = record;
  const data = Buffer.from(canonicalize(payload), 'utf8');
  const key = createPrivateKey(privateKeyPem);
  // ed25519: algorithm parameter must be null (the curve is implicit in the key)
  return cryptoSign(null, data, key).toString('base64');
}

/**
 * Verifies a signature over arbitrary data — used both for canonical
 * record verification and raw nonce verification (challenge response).
 *
 * `algorithm` selects the verifier:
 *   - 'ed25519'    → algorithm parameter null (curve is implicit in key)
 *   - 'rsa-sha256' → algorithm parameter 'sha256'
 */
export function verifySignature(
  data: Buffer | string,
  signatureBase64: string,
  publicKeyPem: string,
  algorithm: SigningAlgorithm,
): boolean {
  const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  const sigBuffer = Buffer.from(signatureBase64, 'base64');
  const key = createPublicKey(publicKeyPem);
  const cryptoAlg = algorithm === 'ed25519' ? null : 'sha256';
  return cryptoVerify(cryptoAlg, dataBuffer, key, sigBuffer);
}

/**
 * Verifies a signature over the canonical-JSON projection of `record`,
 * stripping `signature_value` first (the signature does not sign itself).
 *
 * Use this for read-path verification of EntityOwner records and the
 * root manifest. For raw nonce challenge verification, call
 * `verifySignature` directly.
 */
export function verifyCanonical(
  record: Record<string, unknown>,
  signatureBase64: string,
  publicKeyPem: string,
  algorithm: SigningAlgorithm,
): boolean {
  const { signature_value: _strip, ...payload } = record;
  return verifySignature(
    canonicalize(payload),
    signatureBase64,
    publicKeyPem,
    algorithm,
  );
}

/**
 * Derives the public key PEM from a private key PEM.
 * Used by the resolver to verify EntityOwner root signatures without
 * requiring a separate public key env var.
 */
export function derivePublicKey(privateKeyPem: string): string {
  return createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }) as string;
}

/**
 * Verifies an AgentCard signature per §2.5 of the NANDA Layer 2 spec.
 *
 * AgentCards use `signature` as the signature field (not `signature_value`).
 * Strips `signature` before canonicalizing — the signature must not sign itself.
 *
 * @param card          - AgentCard as a plain object
 * @param signatureB64  - base64-encoded signature from the card's `signature` field
 * @param publicKeyPem  - EntityOwner public key (PEM) from the GARR registry
 * @param algorithm     - signing algorithm declared in the EntityOwner record
 */
export function verifyAgentCardSignature(
  card: Record<string, unknown>,
  signatureB64: string,
  publicKeyPem: string,
  algorithm: SigningAlgorithm,
): boolean {
  const { signature: _strip, ...payload } = card;
  return verifySignature(canonicalize(payload), signatureB64, publicKeyPem, algorithm);
}
