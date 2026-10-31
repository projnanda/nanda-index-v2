import { createHash } from 'node:crypto';
import bcrypt from 'bcrypt';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql, closeSql } from '../../src/db/client.js';
import {
  createUserWithPassword,
  findUserById,
  upsertUser,
  type User,
} from '../../src/db/queries/users.js';
import { createPasswordHasher } from '../../src/lib/password.js';
import { createResetToken } from '../../src/db/queries/passwordResetTokens.js';
import * as email from '../../src/services/email.js';

vi.mock('../../src/services/email.js', async (original) => ({
  ...(await original<typeof import('../../src/services/email.js')>()),
  sendAccountDeletionEmail: vi.fn(),
}));

const PASSWORD = 'existing-account-password';
const NEW_PASSWORD = 'new-account-password';
let app: FastifyInstance;
let hash: string;
let sequence = 0;
const sql = () => getSql();
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const tokenFor = (user: User) =>
  app.jwt.sign({
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    tokenVersion: user.tokenVersion,
  });
async function user(provider: 'email' | 'google' = 'email', verified = true) {
  const email = `account-settings-${++sequence}@example.com`;
  const row =
    provider === 'email'
      ? await createUserWithPassword(email, hash, 'Initial name')
      : await upsertUser({
          email,
          displayName: 'Provider name',
          avatarUrl: null,
          provider,
          providerId: email,
          emailVerified: verified,
        });
  return { row, token: tokenFor(row) };
}
function remove(token: string, body: Record<string, unknown> = { current_password: PASSWORD }) {
  return app.inject({
    method: 'DELETE',
    url: '/api/v1/me',
    headers: auth(token),
    payload: { confirmation: 'DELETE', ...body },
  });
}
function change(token: string, current = PASSWORD, next = NEW_PASSWORD) {
  return app.inject({
    method: 'POST',
    url: '/auth/change-password',
    headers: auth(token),
    payload: { current_password: current, new_password: next },
  });
}
async function org(users: { row: User; role?: 'admin' | 'member' }[]) {
  const id = `account-settings-org-${++sequence}`;
  await sql()`INSERT INTO organizations (org_id, display_name, domain, contact_email, registry_url, identifier, status, email_verified)
    VALUES (${id}, 'Published shared entry', ${`${id}.example.com`}, 'publisher@example.com', 'https://example.com/card', ${`urn:air:${id}.example.com:agent:main`}, 'active', true)`;
  for (const item of users)
    await sql()`INSERT INTO org_memberships (user_id, org_id, role) VALUES (${item.row.id}, ${id}, ${item.role ?? 'admin'})`;
  return id;
}
async function deletionCode(token: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/request-account-deletion',
    headers: auth(token),
  });
  expect(response.statusCode).toBe(200);
  const calls = vi.mocked(email.sendAccountDeletionEmail).mock.calls;
  return calls[calls.length - 1]![1];
}

beforeAll(async () => {
  process.env.AUTH_RATE_LIMIT_MAX = '1000';
  hash = await createPasswordHasher(1).hash(PASSWORD);
  app = (await buildServer({ logger: false })).fastify;
  await app.ready();
});
beforeEach(async () => {
  await sql()`DELETE FROM organizations WHERE org_id LIKE 'account-settings-%'`;
  await sql()`DELETE FROM users WHERE email LIKE 'account-settings-%'`;
  await sql()`DELETE FROM login_failures WHERE email LIKE 'account-settings-%'`;
  vi.mocked(email.sendAccountDeletionEmail).mockReset();
});
afterAll(async () => {
  await app.close();
  await closeSql();
});

describe('account settings authorization and profile', () => {
  it.each([
    ['PATCH', '/api/v1/me', { display_name: 'Name' }],
    ['POST', '/auth/change-password', { current_password: PASSWORD, new_password: NEW_PASSWORD }],
    ['POST', '/auth/logout-all', undefined],
    ['DELETE', '/api/v1/me', { confirmation: 'DELETE', current_password: PASSWORD }],
    ['POST', '/auth/request-account-deletion', undefined],
  ] as const)('requires a session for %s %s', async (method, url, payload) => {
    expect((await app.inject({ method, url, payload })).statusCode).toBe(401);
  });

  it('updates only the caller profile and returns a current session with the new name', async () => {
    const owner = await user();
    const other = await user();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: auth(owner.token),
      payload: { display_name: '  Élodie 李 🧪  ', email: other.row.email },
    });
    expect(res.statusCode).toBe(200);
    expect((await findUserById(owner.row.id))?.displayName).toBe('Élodie 李 🧪');
    expect((await findUserById(owner.row.id))?.email).toBe(owner.row.email);
    expect((await findUserById(other.row.id))?.displayName).toBe('Initial name');
    expect(app.jwt.verify<{ displayName: string }>(res.json().token).displayName).toBe(
      'Élodie 李 🧪',
    );
    expect(
      (await app.inject({ url: '/api/v1/me', headers: auth(res.json().token) })).statusCode,
    ).toBe(200);
  });

  it('allows clearing the display name and rejects oversized names', async () => {
    const owner = await user();
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/v1/me',
          headers: auth(owner.token),
          payload: { display_name: 'x'.repeat(256) },
        })
      ).statusCode,
    ).toBe(400);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: auth(owner.token),
      payload: { display_name: '   ' },
    });
    expect(res.statusCode).toBe(200);
    expect((await findUserById(owner.row.id))?.displayName).toBeNull();
  });

  it('keeps an edited OAuth display name when the provider signs in again', async () => {
    const owner = await user('google');
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: auth(owner.token),
      payload: { display_name: 'My chosen name' },
    });
    const refreshed = await upsertUser({
      email: owner.row.email,
      displayName: 'Provider name again',
      avatarUrl: 'https://example.com/avatar',
      provider: 'google',
      providerId: owner.row.providerId,
      emailVerified: true,
    });
    expect(refreshed.displayName).toBe('My chosen name');
    expect(refreshed.avatarUrl).toBe('https://example.com/avatar');
  });
});

describe('passwords and sessions', () => {
  it('requires the correct current password and leaves sessions intact on failure', async () => {
    const owner = await user();
    expect((await change(owner.token, 'wrong-password')).statusCode).toBe(403);
    expect((await findUserById(owner.row.id))?.tokenVersion).toBe(0);
    expect((await app.inject({ url: '/api/v1/me', headers: auth(owner.token) })).statusCode).toBe(
      200,
    );
  });

  it('validates the new password before changing it', async () => {
    const owner = await user();
    expect((await change(owner.token, PASSWORD, 'short')).statusCode).toBe(400);
    expect((await findUserById(owner.row.id))?.passwordHash).toBe(hash);
  });

  it('changes the password, revokes every prior session, and invalidates outstanding resets', async () => {
    const owner = await user();
    const reset = await createResetToken(owner.row.id, 10);
    const second = app.jwt.sign(
      { userId: owner.row.id, email: owner.row.email, displayName: null, tokenVersion: 0 },
      { expiresIn: '2h' },
    );
    expect((await change(owner.token)).statusCode).toBe(200);
    for (const token of [owner.token, second])
      expect((await app.inject({ url: '/api/v1/me', headers: auth(token) })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: owner.row.email, password: PASSWORD },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: owner.row.email, password: NEW_PASSWORD },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/reset-password',
          payload: { token: reset.token, password: PASSWORD },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('lets only one simultaneous password change use the old credentials', async () => {
    const owner = await user();
    const responses = await Promise.all([
      change(owner.token, PASSWORD, 'new-password-one'),
      change(owner.token, PASSWORD, 'new-password-two'),
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 401]);
    expect((await findUserById(owner.row.id))?.tokenVersion).toBe(1);
  });

  it('consumes a reset once even when two requests reach it together', async () => {
    const owner = await user();
    const reset = await createResetToken(owner.row.id, 10);
    const responses = await Promise.all(
      [NEW_PASSWORD, 'another-password'].map((password) =>
        app.inject({
          method: 'POST',
          url: '/auth/reset-password',
          payload: { token: reset.token, password },
        }),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 400]);
    expect((await findUserById(owner.row.id))?.tokenVersion).toBe(1);
  });

  it('signs out every session and rejects later mutations by revoked sessions', async () => {
    const owner = await user();
    expect(
      (await app.inject({ method: 'POST', url: '/auth/logout-all', headers: auth(owner.token) }))
        .statusCode,
    ).toBe(200);
    expect((await findUserById(owner.row.id))?.tokenVersion).toBe(1);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/v1/me',
          headers: auth(owner.token),
          payload: { display_name: 'Stale' },
        })
      ).statusCode,
    ).toBe(401);
    expect((await remove(owner.token)).statusCode).toBe(401);
  });

  it('does not add a password to an OAuth account using a session alone', async () => {
    const owner = await user('google');
    expect((await change(owner.token)).statusCode).toBe(409);
    expect((await findUserById(owner.row.id))?.passwordHash).toBeNull();
  });
});

describe('account deletion and ownership', () => {
  it('requires explicit confirmation and a correct password', async () => {
    const owner = await user();
    expect((await remove(owner.token, { current_password: 'wrong-password' })).statusCode).toBe(
      403,
    );
    expect(
      (await remove(owner.token, { current_password: PASSWORD, confirmation: 'no' })).statusCode,
    ).toBe(400);
    expect(await findUserById(owner.row.id)).not.toBeNull();
  });

  it('blocks sole administrators and returns entry links without deleting any account data', async () => {
    const owner = await user();
    const member = await user();
    const id = await org([owner, { row: member.row, role: 'member' }]);
    const res = await remove(owner.token);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: 'SOLE_ADMIN',
      organizations: [{ org_id: id, display_name: 'Published shared entry' }],
    });
    expect(await findUserById(owner.row.id)).not.toBeNull();
    expect(
      (await sql()`SELECT * FROM org_memberships WHERE user_id = ${owner.row.id}`).length,
    ).toBe(1);
    const me = await app.inject({ url: '/api/v1/me', headers: auth(owner.token) });
    expect(me.json().deletion_blockers).toEqual([
      { org_id: id, display_name: 'Published shared entry' },
    ]);
  });

  it('removes memberships and private account data while preserving shared published entries', async () => {
    const owner = await user();
    const other = await user();
    const id = await org([owner, other]);
    await createResetToken(owner.row.id, 10);
    await sql()`INSERT INTO login_failures (email, ip_address, failed_count) VALUES (${owner.row.email}, '127.0.0.1', 1)`;
    expect((await remove(owner.token)).statusCode).toBe(204);
    expect(await findUserById(owner.row.id)).toBeNull();
    expect(await findUserById(other.row.id)).not.toBeNull();
    expect(
      (await sql()`SELECT * FROM password_reset_tokens WHERE user_id = ${owner.row.id}`).length,
    ).toBe(0);
    expect(
      (await sql()`SELECT * FROM login_failures WHERE email = ${owner.row.email}`).length,
    ).toBe(0);
    expect((await sql()`SELECT * FROM org_memberships WHERE org_id = ${id}`).length).toBe(1);
    expect(
      (await sql()`SELECT status, contact_email FROM organizations WHERE org_id = ${id}`)[0],
    ).toMatchObject({ status: 'active', contactEmail: 'publisher@example.com' });
    expect((await app.inject({ url: '/api/v1/me', headers: auth(owner.token) })).statusCode).toBe(
      401,
    );
  });

  it('allows a regular member to leave without deleting the administrator or entry', async () => {
    const owner = await user();
    const member = await user();
    const id = await org([owner, { row: member.row, role: 'member' }]);
    expect((await remove(member.token)).statusCode).toBe(204);
    expect((await sql()`SELECT * FROM org_memberships WHERE org_id = ${id}`)[0]?.userId).toBe(
      owner.row.id,
    );
  });

  it('never removes both administrators when shared admins delete concurrently', async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const a = await user();
      const b = await user();
      const id = await org([a, b]);
      const responses = await Promise.all([remove(a.token), remove(b.token)]);
      expect(responses.map((r) => r.statusCode).sort()).toEqual([204, 409]);
      expect(
        (await sql()`SELECT * FROM org_memberships WHERE org_id = ${id} AND role = 'admin'`).length,
      ).toBe(1);
    }
  });
});

describe('OAuth deletion proofs', () => {
  it('sends only to the verified stored email, stores a hash, and enforces a cooldown', async () => {
    const owner = await user('google');
    const code = await deletionCode(owner.token);
    expect(vi.mocked(email.sendAccountDeletionEmail)).toHaveBeenLastCalledWith(
      owner.row.email,
      code,
    );
    const rows = await sql()`SELECT * FROM account_deletion_tokens WHERE user_id = ${owner.row.id}`;
    expect(rows[0]?.tokenHash).toBe(createHash('sha256').update(code).digest('hex'));
    expect(rows[0]?.tokenHash).not.toBe(code);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/request-account-deletion',
          headers: auth(owner.token),
        })
      ).statusCode,
    ).toBe(429);
  });

  it('does not send a code to an unverified OAuth email or password account', async () => {
    const oauth = await user('google', false);
    const password = await user();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/request-account-deletion',
          headers: auth(oauth.token),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/request-account-deletion',
          headers: auth(password.token),
        })
      ).statusCode,
    ).toBe(409);
    expect(vi.mocked(email.sendAccountDeletionEmail)).not.toHaveBeenCalled();
  });

  it('requires a valid code bound to the same account and deletes it with the account', async () => {
    const owner = await user('google');
    const other = await user('google');
    const code = await deletionCode(owner.token);
    expect((await remove(owner.token, {})).statusCode).toBe(403);
    expect((await remove(other.token, { deletion_code: code })).statusCode).toBe(403);
    expect((await remove(owner.token, { deletion_code: code })).statusCode).toBe(204);
    expect(
      (await sql()`SELECT * FROM account_deletion_tokens WHERE user_id = ${owner.row.id}`).length,
    ).toBe(0);
    expect((await remove(owner.token, { deletion_code: code })).statusCode).toBe(401);
  });

  it('rejects expired and revoked codes even with a fresh session', async () => {
    const expired = await user('google');
    const code = await deletionCode(expired.token);
    await sql()`UPDATE account_deletion_tokens SET expires_at = NOW() - INTERVAL '1 second' WHERE user_id = ${expired.row.id}`;
    expect((await remove(expired.token, { deletion_code: code })).statusCode).toBe(403);
    const revoked = await user('google');
    const revokedCode = await deletionCode(revoked.token);
    await app.inject({ method: 'POST', url: '/auth/logout-all', headers: auth(revoked.token) });
    const current = (await findUserById(revoked.row.id))!;
    expect((await remove(tokenFor(current), { deletion_code: revokedCode })).statusCode).toBe(403);
  });

  it('does not consume a code on ownership conflict, so retirement can be followed by deletion', async () => {
    const owner = await user('google');
    const id = await org([owner]);
    const code = await deletionCode(owner.token);
    expect((await remove(owner.token, { deletion_code: code })).statusCode).toBe(409);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/orgs/${id}`,
          headers: auth(owner.token),
        })
      ).statusCode,
    ).toBe(204);
    expect((await remove(owner.token, { deletion_code: code })).statusCode).toBe(204);
  });

  it('rejects a code issued before the provider changed the verified account email', async () => {
    const owner = await user('google');
    const code = await deletionCode(owner.token);
    await upsertUser({
      email: `account-settings-changed-${sequence}@example.com`,
      displayName: null,
      avatarUrl: null,
      provider: 'google',
      providerId: owner.row.providerId,
      emailVerified: true,
    });
    expect((await remove(owner.token, { deletion_code: code })).statusCode).toBe(403);
    expect(await findUserById(owner.row.id)).not.toBeNull();
  });

  it('reports mail failure without retaining an unusable cooldown', async () => {
    const owner = await user('google');
    vi.mocked(email.sendAccountDeletionEmail).mockRejectedValueOnce(new Error('delivery failed'));
    const res = await app.inject({
      method: 'POST',
      url: '/auth/request-account-deletion',
      headers: auth(owner.token),
    });
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('delivery failed');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/request-account-deletion',
          headers: auth(owner.token),
        })
      ).statusCode,
    ).toBe(200);
  });
});

describe('new password UTF-8 byte limits', () => {
  async function submit(kind: 'register' | 'reset' | 'change', password: string) {
    if (kind === 'register')
      return app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: `account-settings-boundary-${++sequence}@example.com`, password },
      });
    const owner = await user();
    if (kind === 'change') return change(owner.token, PASSWORD, password);
    const reset = await createResetToken(owner.row.id, 10);
    return app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: reset.token, password },
    });
  }

  for (const kind of ['register', 'reset', 'change'] as const) {
    it.each([
      ['ASCII', 'a'.repeat(72)],
      ['accented', 'é'.repeat(36)],
      ['emoji', '🧪'.repeat(18)],
    ])(`accepts a 72-byte %s password for ${kind}`, async (_label, password) => {
      const res = await submit(kind, password);
      expect(res.statusCode).toBe(kind === 'register' ? 201 : 200);
    });
    it.each([
      ['ASCII', 'a'.repeat(73)],
      ['accented', 'é'.repeat(37)],
      ['emoji', '🧪'.repeat(19)],
    ])(`rejects a password over 72 UTF-8 bytes for ${kind} (%s)`, async (_label, password) => {
      const res = await submit(kind, password);
      expect(res.statusCode).toBe(400);
      expect(res.json().detail).toContain('72');
    });
  }

  it('keeps legacy long credentials usable for login and current-password confirmation', async () => {
    const legacy = 'é'.repeat(50);
    const address = `account-settings-legacy-${++sequence}@example.com`;
    const owner = await createUserWithPassword(
      address,
      await bcrypt.hash(legacy, 10),
      'Legacy account',
    );
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: address, password: legacy },
    });
    expect(login.statusCode).toBe(200);
    expect((await change(login.json().token, legacy, NEW_PASSWORD)).statusCode).toBe(200);
    expect(
      await createPasswordHasher(1).verify(
        NEW_PASSWORD,
        (await findUserById(owner.id))?.passwordHash,
      ),
    ).toBe(true);
  });

  it('rate-limits repeated current-password attempts', async () => {
    const saved = process.env.AUTH_RATE_LIMIT_MAX;
    process.env.AUTH_RATE_LIMIT_MAX = '2';
    const limited = (await buildServer({ logger: false })).fastify;
    process.env.AUTH_RATE_LIMIT_MAX = saved;
    await limited.ready();
    try {
      const owner = await user();
      const request = () =>
        limited.inject({
          method: 'POST',
          url: '/auth/change-password',
          headers: auth(owner.token),
          payload: { current_password: 'wrong-password', new_password: NEW_PASSWORD },
        });
      expect((await request()).statusCode).toBe(403);
      expect((await request()).statusCode).toBe(403);
      expect((await request()).statusCode).toBe(429);
      expect((await findUserById(owner.row.id))?.passwordHash).toBe(hash);
    } finally {
      await limited.close();
    }
  });
});
