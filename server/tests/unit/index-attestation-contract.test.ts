import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import vector from '../fixtures/index-attestation-draft.json' with { type: 'json' };
import { canonicalize, signCanonical, verifyCanonical } from '../../src/services/signing.js';

// Draft payload, not a deployed API schema. These tests exercise byte binding,
// not expiry, key trust, revocation, or acceptance of an assertion by a client.
describe('index attestation draft — cryptographic binding', () => {
  const { payload, canonicalJson, publicKeyPem, signature } = vector;
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');

  it('matches a fixed canonical byte sequence and independently signed vector', () => {
    expect(canonicalize(payload)).toBe(canonicalJson);
    expect(verify(null, Buffer.from(canonicalJson), publicKeyPem, Buffer.from(signature, 'base64'))).toBe(true);
    expect(verifyCanonical(payload, signature, publicKeyPem, 'ed25519')).toBe(true);
  });

  it('signs bytes verifiable without the repository verifier', () => {
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const signed = signCanonical(payload, pem);
    expect(verify(null, Buffer.from(canonicalJson), publicKey, Buffer.from(signed, 'base64'))).toBe(true);
  });

  it.each(Object.entries(payload))('rejects substitution of signed field %s', (field, value) => {
    const changed = { ...payload, [field]: typeof value === 'number' ? value + 1 : `${value}-altered` };
    expect(verifyCanonical(changed, signature, publicKeyPem, 'ed25519')).toBe(false);
  });

  it.each(Object.keys(payload))('rejects removal of signed field %s', (field) => {
    const changed: Record<string, unknown> = { ...payload };
    delete changed[field];
    expect(verifyCanonical(changed, signature, publicKeyPem, 'ed25519')).toBe(false);
  });

  it('accepts reordered object keys without changing the signed meaning', () => {
    const reordered = Object.fromEntries(Object.entries(payload).reverse());
    expect(verifyCanonical(reordered, signature, publicKeyPem, 'ed25519')).toBe(true);
  });

  it('rejects a signature checked with another key', () => {
    const otherPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(verifyCanonical(payload, signature, otherPem, 'ed25519')).toBe(false);
  });

  it('rejects a corrupted signature', () => {
    const corrupted = Buffer.from(signature, 'base64');
    corrupted[0] = corrupted[0]! ^ 1;
    expect(verifyCanonical(payload, corrupted.toString('base64'), publicKeyPem, 'ed25519')).toBe(false);
  });

  it('rejects appended unsigned claims', () => {
    expect(verifyCanonical({ ...payload, authorizedToInvoke: true }, signature, publicKeyPem, 'ed25519')).toBe(false);
  });
});
