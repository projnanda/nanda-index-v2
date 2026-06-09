import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  canonicalize,
  generateChallengeNonce,
  signCanonical,
  verifyCanonical,
  verifySignature,
} from '../../src/services/signing.js';

function ed25519PemKeypair(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

describe('canonicalize', () => {
  it('sorts object keys lexicographically', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts keys recursively in nested objects', () => {
    expect(canonicalize({ outer: { z: 1, a: 2 }, alpha: 1 })).toBe(
      '{"alpha":1,"outer":{"a":2,"z":1}}',
    );
  });

  it('preserves array order, sorting keys within array elements', () => {
    expect(canonicalize([{ b: 1, a: 2 }, { z: 3 }])).toBe(
      '[{"a":2,"b":1},{"z":3}]',
    );
  });

  it('emits no whitespace', () => {
    const out = canonicalize({ a: 1, b: [2, 3] });
    expect(out).not.toMatch(/\s/);
  });

  it('handles primitives', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(false)).toBe('false');
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize('hi')).toBe('"hi"');
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalize(NaN)).toThrow(/non-finite/);
    expect(() => canonicalize(Infinity)).toThrow(/non-finite/);
  });
});

describe('generateChallengeNonce', () => {
  it('returns 64 hex chars (32 bytes)', () => {
    const nonce = generateChallengeNonce();
    expect(nonce).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns a different value on each call', () => {
    expect(generateChallengeNonce()).not.toBe(generateChallengeNonce());
  });
});

describe('signCanonical / verifyCanonical', () => {
  const record = {
    owner_id: 'test-org',
    domain: 'example.com',
    serial: '2026042601',
  };

  it('round-trips a record through ed25519 sign + verify', () => {
    const { privatePem, publicPem } = ed25519PemKeypair();
    const signature = signCanonical(record, privatePem);
    expect(verifyCanonical(record, signature, publicPem, 'ed25519')).toBe(true);
  });

  it('detects tampering — modified field fails verification', () => {
    const { privatePem, publicPem } = ed25519PemKeypair();
    const signature = signCanonical(record, privatePem);
    const tampered = { ...record, domain: 'attacker.com' };
    expect(verifyCanonical(tampered, signature, publicPem, 'ed25519')).toBe(false);
  });

  it('strips signature_value before signing — round-trip ignores stale value', () => {
    const { privatePem, publicPem } = ed25519PemKeypair();
    // Sign once
    const signature = signCanonical(record, privatePem);
    // Now embed a different "stale" signature_value and re-verify against the real signature
    const recordWithStaleSignature = { ...record, signature_value: 'stale-value' };
    expect(
      verifyCanonical(recordWithStaleSignature, signature, publicPem, 'ed25519'),
    ).toBe(true);
  });
});

describe('verifySignature (raw bytes — challenge nonce flow)', () => {
  it('verifies an ed25519 signature over a raw nonce', () => {
    const { privatePem, publicPem } = ed25519PemKeypair();
    const nonce = generateChallengeNonce();
    // The "client" signs the nonce hex bytes directly
    const signature = signCanonical({ nonce }, privatePem);
    // signCanonical wraps in canonical JSON, so the verify side must do the same
    expect(verifySignature(`{"nonce":${JSON.stringify(nonce)}}`, signature, publicPem, 'ed25519')).toBe(true);
  });

  it('returns false for a signature over different data', () => {
    const { privatePem, publicPem } = ed25519PemKeypair();
    const sigForA = signCanonical({ nonce: 'aaa' }, privatePem);
    expect(verifySignature('{"nonce":"bbb"}', sigForA, publicPem, 'ed25519')).toBe(false);
  });
});
