import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql, closeSql } from '../../src/db/client.js';
import { createPasswordHasher } from '../../src/lib/password.js';
import { createUserWithPassword } from '../../src/db/queries/users.js';

/**
 * Signing out revokes that session on the server, so a copied token stops
 * working at once instead of living until it expires. Other sessions of the
 * same account keep working (that is what /auth/logout-all is for).
 */

const PW = 'correct-horse-battery';

async function freshUser(email: string) {
  await getSql()`DELETE FROM users WHERE email = ${email}`;
  return createUserWithPassword(email, await createPasswordHasher(1).hash(PW), 'Logout Test');
}

describe('POST /auth/logout', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.AUTH_RATE_LIMIT_MAX = '1000';
    app = (await buildServer({ logger: false })).fastify;
    await app.ready();
  });

  afterAll(async () => {
    await getSql()`DELETE FROM users WHERE email LIKE 'logout-%@example.com'`;
    await app.close();
    await closeSql();
  });

  async function login(email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PW } });
    return res.json().token as string;
  }
  const me = (token: string) =>
    app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${token}` } });
  const logout = (token?: string) =>
    app.inject({
      method: 'POST', url: '/auth/logout',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it('requires a session', async () => {
    expect((await logout()).statusCode).toBe(401);
  });

  it('revokes the session it is called with', async () => {
    await freshUser('logout-one@example.com');
    const session = await login('logout-one@example.com');

    expect((await logout(session)).json()).toEqual({ ok: true });
    expect((await me(session)).statusCode).toBe(401);
    expect((await logout(session)).statusCode).toBe(401);
  });

  it("leaves the account's other sessions signed in", async () => {
    await freshUser('logout-other@example.com');
    const laptop = await login('logout-other@example.com');
    const phone = await login('logout-other@example.com');

    await logout(laptop);
    expect((await me(laptop)).statusCode).toBe(401);
    expect((await me(phone)).statusCode).toBe(200);
  });

  it('also revokes the token a profile update issued in place of this session', async () => {
    await freshUser('logout-renamed@example.com');
    const session = await login('logout-renamed@example.com');
    const renamed = await app.inject({
      method: 'PATCH', url: '/api/v1/me',
      headers: { authorization: `Bearer ${session}` },
      payload: { display_name: 'Renamed' },
    });
    const renewed = renamed.json().token as string;

    await logout(renewed);
    expect((await me(renewed)).statusCode).toBe(401);
    expect((await me(session)).statusCode).toBe(401);
  });

  it('revokes every session for a token issued before sessions had ids', async () => {
    const user = await freshUser('logout-legacy@example.com');
    const other = await login('logout-legacy@example.com');
    const legacy = app.jwt.sign(
      { userId: user.id, email: user.email, displayName: user.displayName, tokenVersion: user.tokenVersion },
      { expiresIn: '1h' },
    );

    expect((await logout(legacy)).statusCode).toBe(200);
    expect((await me(legacy)).statusCode).toBe(401);
    expect((await me(other)).statusCode).toBe(401);
  });
});
