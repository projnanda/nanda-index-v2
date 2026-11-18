import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  canonicalize,
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

  // A Date has no own enumerable keys, so walking it like a plain object
  // emits "{}" for every date: a signature over it would not bind the time.
  it('rejects Date values instead of emitting {}', () => {
    expect(() => canonicalize({ verifiedAt: new Date('2026-11-05T00:00:00Z') }))
      .toThrow(/plain object.*Date/);
  });

  it('rejects other non-plain objects (Map, Set, Buffer, class instances)', () => {
    class Pointer { readonly url = 'https://example.com'; }
    expect(() => canonicalize({ m: new Map([['a', 1]]) })).toThrow(/plain object.*Map/);
    expect(() => canonicalize({ s: new Set([1]) })).toThrow(/plain object.*Set/);
    expect(() => canonicalize({ b: Buffer.from('x') })).toThrow(/plain object.*Buffer/);
    expect(() => canonicalize(new Pointer())).toThrow(/plain object.*Pointer/);
  });

  it('rejects objects with an inherited prototype, naming it as such', () => {
    expect(() => canonicalize(Object.create({ inherited: 1 })))
      .toThrow(/plain object.*custom prototype/);
  });

  it('reads arrays by index, ignoring an own Symbol.iterator', () => {
    const items = [1, 2, 3];
    Object.defineProperty(items, Symbol.iterator, {
      value: function* () { yield 'substituted'; },
    });
    expect(canonicalize(items)).toBe('[1,2,3]');
  });

  // Code-unit order puts U+1F600 (surrogates D83D DE00) before U+FFFF;
  // code-point order would not.
  it('sorts keys by UTF-16 code unit, not code point', () => {
    const emoji = '\u{1F600}';
    const last = '￿';
    expect(canonicalize({ [last]: 1, [emoji]: 2 })).toBe(
      `{${JSON.stringify(emoji)}:2,${JSON.stringify(last)}:1}`,
    );
  });

  it('accepts null-prototype objects', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { b: 1, a: 2 });
    expect(canonicalize(bare)).toBe('{"a":2,"b":1}');
  });

  it('rejects undefined object values rather than dropping them', () => {
    expect(() => canonicalize({ a: 1, b: undefined })).toThrow(/undefined/);
  });

  it('rejects sparse arrays instead of emitting invalid JSON', () => {
    expect(() => canonicalize([1, , 3])).toThrow(/undefined/);
  });

  it('rejects bigint, symbol and function values', () => {
    expect(() => canonicalize({ n: 1n })).toThrow(/bigint/);
    expect(() => canonicalize({ s: Symbol('x') })).toThrow(/symbol/);
    expect(() => canonicalize({ f: () => 1 })).toThrow(/function/);
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

describe('signCanonical / verifyCanonical — top-level record type', () => {
  // Object rest copies own keys onto a fresh plain object, so the type
  // check has to run on the caller's record before signature_value is
  // stripped, or a Date would be signed as "{}".
  it('refuses a non-plain top-level record instead of signing {}', () => {
    const { privatePem, publicPem } = ed25519PemKeypair();
    const date = new Date('2026-11-05T00:00:00Z') as unknown as Record<string, unknown>;
    expect(() => signCanonical(date, privatePem)).toThrow(/plain object.*Date/);
    const signatureOverEmpty = signCanonical({}, privatePem);
    expect(() => verifyCanonical(date, signatureOverEmpty, publicPem, 'ed25519'))
      .toThrow(/plain object.*Date/);
  });
});

describe('verifySignature (raw bytes)', () => {
  it('verifies an ed25519 signature over the raw canonical bytes', () => {
    const { privatePem, publicPem } = ed25519PemKeypair();
    const nonce = 'a'.repeat(64);
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
