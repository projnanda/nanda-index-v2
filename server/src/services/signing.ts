/**
 * Canonical JSON and Ed25519 signing primitives.
 *
 * No route signs or verifies anything with these yet: index-issued
 * resolution assertions are designed in TRUST_CONTRACT.md and tracked in
 * #92. tests/unit/index-attestation-contract.test.ts pins the canonical
 * bytes those assertions will use.
 */
import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';

export type SigningAlgorithm = 'ed25519' | 'rsa-sha256';

/**
 * Serializes `value` to canonical JSON:
 *   - Object keys sorted by UTF-16 code unit (recursively)
 *   - No whitespace
 *   - Arrays preserve insertion order
 *
 * The output is the byte sequence the signer signs and the verifier
 * verifies, so two implementations given the same record must produce the
 * same bytes.
 *
 * Accepts only JSON values: null, booleans, finite numbers, strings, arrays
 * and plain objects. Anything else throws rather than being coerced. A Date
 * walked like an object becomes "{}", so a signature over it would not cover
 * the time; convert dates to ISO strings before signing.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return canonicalizeNumber(value);
    case 'string':
      return JSON.stringify(value);
    case 'object':
      return Array.isArray(value) ? canonicalizeArray(value) : canonicalizeObject(value);
    case 'undefined':
      throw new Error('canonicalize: undefined is not representable; omit the field or use null');
    default:
      throw new Error(`canonicalize: unsupported type ${typeof value}`);
  }
}

function canonicalizeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error('canonicalize: non-finite numbers are not representable');
  }
  return JSON.stringify(value);
}

function canonicalizeArray(values: readonly unknown[]): string {
  // Read by index, not through the iterator: an own Symbol.iterator could
  // substitute other items. A hole reads as undefined and throws, where
  // map() would skip it and join() would emit invalid JSON like "[1,,3]".
  const items = Array.from({ length: values.length }, (_, i) => canonicalize(values[i]));
  return '[' + items.join(',') + ']';
}

function canonicalizeObject(value: object): string {
  assertPlainObject(value);
  const record = value as Record<string, unknown>;
  const members = Object.keys(record)
    .sort()
    .map((key) => JSON.stringify(key) + ':' + canonicalize(record[key]));
  return '{' + members.join(',') + '}';
}

function assertPlainObject(value: object): void {
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(
      `canonicalize: only plain objects are representable (got ${describeNonPlain(value)})`,
    );
  }
}

function describeNonPlain(value: object): string {
  const name: unknown = (value as { constructor?: { name?: unknown } }).constructor?.name;
  // "Object" here means Object.create(someProto) or another realm's object;
  // printing it would read as "only plain objects (got Object)".
  return typeof name === 'string' && name !== '' && name !== 'Object'
    ? name
    : 'an object with a custom prototype';
}

/**
 * Signs the canonical-JSON projection of `record` with an Ed25519 private
 * key (PEM). crypto.sign's algorithm argument is null, as Ed25519 requires.
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
  // Before the rest copy below, which would turn any object into a plain one.
  assertPlainObject(record);
  const { signature_value: _strip, ...payload } = record;
  const data = Buffer.from(canonicalize(payload), 'utf8');
  const key = createPrivateKey(privateKeyPem);
  return cryptoSign(null, data, key).toString('base64');
}

/**
 * Verifies a base64 signature over raw bytes.
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
 * Counterpart of signCanonical: verifies a signature over the canonical-JSON
 * projection of `record`, stripping `signature_value` first (the signature
 * does not sign itself).
 */
export function verifyCanonical(
  record: Record<string, unknown>,
  signatureBase64: string,
  publicKeyPem: string,
  algorithm: SigningAlgorithm,
): boolean {
  assertPlainObject(record);
  const { signature_value: _strip, ...payload } = record;
  return verifySignature(
    canonicalize(payload),
    signatureBase64,
    publicKeyPem,
    algorithm,
  );
}
