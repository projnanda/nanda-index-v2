import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql, closeSql } from '../../src/db/client.js';

/**
 * In production the OAuth cookies (the provider state cookie and the login
 * nonce) are Secure, so they never travel over plain http.
 */

const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a-jwt-secret-long-enough-for-production-use',
  COOKIE_SECRET: 'a-cookie-secret-long-enough-for-production-use',
  GOOGLE_CLIENT_ID: 'test-google-client',
  GOOGLE_CLIENT_SECRET: 'test-google-secret',
};
const PROVIDER_ID = 'oauth-cookies-production-id';

interface CookieLike { name: string; secure?: boolean; httpOnly?: boolean }

describe('OAuth cookies in production', () => {
  let app: FastifyInstance;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [key, value] of Object.entries(PRODUCTION_ENV)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
    app = (await buildServer({ logger: false })).fastify;
    await app.ready();
    for (const key of Object.keys(PRODUCTION_ENV)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await getSql()`DELETE FROM users WHERE provider_id = ${PROVIDER_ID}`;
    await app.close();
    await closeSql();
  });

  it('marks the OAuth state cookie Secure', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/google' });

    expect(res.statusCode).toBe(302);
    const state = (res.cookies as CookieLike[]).find((c) => c.name === 'oauth2-redirect-state');
    expect(state).toBeDefined();
    expect(state!.secure).toBe(true);
    expect(state!.httpOnly).toBe(true);
  });

  it('marks the login nonce cookie Secure', async () => {
    app.oauth2Google!.getAccessTokenFromAuthorizationCodeFlow = vi.fn(async () => ({
      token: { access_token: 'google-access-token' },
    })) as never;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: PROVIDER_ID, email: 'oauth-cookies-production@example.com', verified_email: true,
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    const res = await app.inject({ method: 'GET', url: '/auth/google/callback?code=c&state=s' });

    const nonce = (res.cookies as CookieLike[]).find((c) => c.name === 'nanda_login_nonce');
    expect(nonce?.secure).toBe(true);
  });
});
