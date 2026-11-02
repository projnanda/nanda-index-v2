import { describe, it, expect } from 'vitest';
import { lockoutMinutesFor, accountLockoutMinutesFor } from '../../src/db/queries/loginFailures.js';

const policy = { maxAttempts: 5, lockoutMinutes: 15 };

describe('lockoutMinutesFor', () => {
  it('does not lock below the threshold', () => {
    expect(lockoutMinutesFor(4, policy)).toBe(0);
  });

  it('locks for the base window at the threshold', () => {
    expect(lockoutMinutesFor(5, policy)).toBe(15);
  });

  it('doubles the window for each failure past the threshold', () => {
    expect(lockoutMinutesFor(6, policy)).toBe(30);
    expect(lockoutMinutesFor(7, policy)).toBe(60);
  });

  it('caps a single lock at one day', () => {
    expect(lockoutMinutesFor(50, policy)).toBe(24 * 60);
  });
});

describe('accountLockoutMinutesFor', () => {
  const accountPolicy = { ...policy, maxAccountAttempts: 50 };

  it('does not lock below the account-wide threshold', () => {
    expect(accountLockoutMinutesFor(49, accountPolicy)).toBe(0);
  });

  it('locks for the base window at and past the threshold, without doubling', () => {
    expect(accountLockoutMinutesFor(50, accountPolicy)).toBe(15);
    expect(accountLockoutMinutesFor(500, accountPolicy)).toBe(15);
  });
});
