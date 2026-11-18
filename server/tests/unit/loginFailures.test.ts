import { describe, it, expect } from 'vitest';
import { lockoutMinutesFor, accountLockoutMinutesFor } from '../../src/db/queries/loginFailures.js';

const policy = { maxAttempts: 5, initialLockoutMinutes: 1, lockoutMinutes: 15 };

describe('lockoutMinutesFor', () => {
  it('does not lock below the threshold', () => {
    expect(lockoutMinutesFor(4, policy)).toBe(0);
  });

  it('starts with a short lock at the threshold', () => {
    expect(lockoutMinutesFor(5, policy)).toBe(1);
  });

  it('doubles the lock for each failure past the threshold', () => {
    expect(lockoutMinutesFor(6, policy)).toBe(2);
    expect(lockoutMinutesFor(7, policy)).toBe(4);
    expect(lockoutMinutesFor(8, policy)).toBe(8);
  });

  it('caps a single lock at lockoutMinutes', () => {
    expect(lockoutMinutesFor(9, policy)).toBe(15);
    expect(lockoutMinutesFor(500, policy)).toBe(15);
  });

  it('never starts above the cap', () => {
    expect(lockoutMinutesFor(5, { ...policy, initialLockoutMinutes: 30 })).toBe(15);
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
