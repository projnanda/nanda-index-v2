import bcrypt from 'bcrypt';
import { createConcurrencyLimit } from './concurrencyLimit.js';

/**
 * Password hashing for email/password accounts.
 *
 * Native bcrypt runs each hash on libuv's thread pool, so the ~70 ms of CPU a
 * cost-10 hash takes no longer blocks the event loop. bcryptjs did that work
 * in JavaScript on the main thread, and every other request waited behind it
 * (see loadtest/README.md). Hashes bcryptjs made ($2b$) verify unchanged.
 *
 * Hashes are also capped at `maxConcurrent` at a time. The thread pool has 4
 * threads by default, and DNS lookups and file reads need them too; and on a
 * small CPU budget, 4 hashes at once can use it all and stall the event loop
 * anyway.
 */

const BCRYPT_ROUNDS = 10;

// Unknown emails (and OAuth-only accounts) are compared against this hash so
// a failed login costs one bcrypt compare either way — response time must not
// reveal whether an account exists.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('nanda-index-dummy-password', BCRYPT_ROUNDS);

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /** True only if `hash` exists and matches. A missing hash still costs one compare. */
  verify(password: string, hash: string | null | undefined): Promise<boolean>;
}

export function createPasswordHasher(maxConcurrent: number): PasswordHasher {
  const limit = createConcurrencyLimit(maxConcurrent);

  return {
    hash: password => limit(() => bcrypt.hash(password, BCRYPT_ROUNDS)),
    verify: async (password, hash) => {
      const valid = await limit(() => bcrypt.compare(password, hash ?? DUMMY_PASSWORD_HASH));
      return valid && !!hash;
    },
  };
}
