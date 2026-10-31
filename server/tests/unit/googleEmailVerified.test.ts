import { describe, it, expect } from 'vitest';
import { googleEmailVerified } from '../../src/routes/auth.js';

describe('googleEmailVerified', () => {
  it('accepts an address Google reports as verified', () => {
    expect(googleEmailVerified({ verified_email: true })).toBe(true);
  });

  it('rejects an address Google reports as unverified', () => {
    expect(googleEmailVerified({ verified_email: false })).toBe(false);
  });

  it('rejects a profile with no verified_email flag', () => {
    expect(googleEmailVerified({})).toBe(false);
  });

  it('rejects a null flag', () => {
    expect(googleEmailVerified({ verified_email: null })).toBe(false);
  });

  it('rejects non-boolean truthy values', () => {
    expect(googleEmailVerified({ verified_email: 'true' })).toBe(false);
    expect(googleEmailVerified({ verified_email: 1 })).toBe(false);
  });
});
