import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { createPasswordHasher } from '../../src/lib/password.js';

const PW = 'correct-horse-battery';

// Hashes of PW made by bcryptjs (cost 10), the library that produced every
// password hash already in the database. bcryptjs 3 writes $2b$; $2a$ is what
// pgcrypto (the load-test seed) and older bcrypt libraries write.
const BCRYPTJS_2B = '$2b$10$SrS3JMe4gyFUMoSmOyYsjOd8eDP26.UeKW6nYQj7BFp3lyP.cU4wS';
const BCRYPTJS_2A = '$2a$10$SrS3JMe4gyFUMoSmOyYsjOd8eDP26.UeKW6nYQj7BFp3lyP.cU4wS';

const passwords = createPasswordHasher(2);

describe('createPasswordHasher', () => {
  it('verifies a password against its own hash', async () => {
    const hash = await passwords.hash(PW);
    expect(hash).toMatch(/^\$2b\$10\$/);
    expect(await passwords.verify(PW, hash)).toBe(true);
    expect(await passwords.verify('wrong-password', hash)).toBe(false);
  });

  it('still verifies hashes made by bcryptjs, so existing users can sign in', async () => {
    expect(await passwords.verify(PW, BCRYPTJS_2B)).toBe(true);
    expect(await passwords.verify(PW, BCRYPTJS_2A)).toBe(true);
    expect(await passwords.verify('wrong-password', BCRYPTJS_2B)).toBe(false);
  });

  it('rejects every password when there is no hash (unknown email, OAuth-only account)', async () => {
    expect(await passwords.verify(PW, null)).toBe(false);
    expect(await passwords.verify(PW, undefined)).toBe(false);
    // Not even the password behind the internal dummy hash.
    expect(await passwords.verify('nanda-index-dummy-password', null)).toBe(false);
  });

  it('keeps the event loop idle while a hash is checked', async () => {
    // Event-loop utilization is the share of wall time the loop spent running
    // code rather than waiting. A cost-10 check done on the main thread (as
    // bcryptjs did) reads 1.0; done on the thread pool it reads ~0.001, and
    // stays there even when the CPU is contended.
    const before = performance.eventLoopUtilization();
    expect(await passwords.verify(PW, BCRYPTJS_2B)).toBe(true);
    expect(performance.eventLoopUtilization(before).utilization).toBeLessThan(0.5);
  });

  it('rejects a concurrency limit below 1', () => {
    expect(() => createPasswordHasher(0)).toThrow(RangeError);
  });
});
