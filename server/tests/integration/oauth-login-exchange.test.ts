import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql, closeSql } from '../../src/db/client.js';
import { upsertUser } from '../../src/db/queries/users.js';
import { createLoginExchangeCode } from '../../src/db/queries/loginExchangeCodes.js';

/**
 * OAuth sign-in hands the web app a short-lived, single-use code (never the
 * session JWT) and the web app swaps it for the JWT with a POST. The code is
 * bound to the browser that finished the OAuth flow by an HttpOnly nonce
 * cookie, so a link carrying someone else's code cannot sign a victim in to
 * the attacker's account (login CSRF), and no JWT ever sits in a URL (#82).
 */

const FRONTEND = 'http://localhost:3000';
const NONCE_COOKIE = 'nanda_login_nonce';
const PROVIDER_ID = 'oauth-exchange-google-id';
const EMAIL = 'oauth-exchange@example.com';

interface CookieLike { name: string; value: string; path?: string; httpOnly?: boolean; sameSite?: string; secure?: boolean; maxAge?: number }

function exchange(app: FastifyInstance, code: string, nonce?: string) {
  return app.inject({
    method: 'POST',
    url: '/auth/exchange',
    payload: { code },
    headers: { origin: FRONTEND },
    ...(nonce ? { cookies: { [NONCE_COOKIE]: nonce } } : {}),
  });
}

async function signedInUser() {
  return upsertUser({
    email: EMAIL, displayName: 'Exchange', avatarUrl: null,
    provider: 'google', providerId: PROVIDER_ID, emailVerified: true,
  });
}

describe('OAuth sign-in code exchange', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.AUTH_RATE_LIMIT_MAX = '1000';
    process.env.GOOGLE_CLIENT_ID = 'test-google-client';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
    app = (await buildServer({ logger: false })).fastify;
    await app.ready();
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    await getSql()`DELETE FROM users WHERE provider_id = ${PROVIDER_ID}`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await getSql()`DELETE FROM users WHERE provider_id = ${PROVIDER_ID}`;
    await app.close();
    await closeSql();
  });

  describe('GET /auth/google/callback', () => {
    async function completeGoogleSignIn() {
      app.oauth2Google!.getAccessTokenFromAuthorizationCodeFlow = vi.fn(async () => ({
        token: { access_token: 'google-access-token' },
      })) as never;
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        id: PROVIDER_ID, email: EMAIL, verified_email: true, name: 'Exchange',
      }), { status: 200, headers: { 'content-type': 'application/json' } })));
      return app.inject({ method: 'GET', url: '/auth/google/callback?code=provider-code&state=s' });
    }

    it('redirects with a one-time code, never the session JWT', async () => {
      const res = await completeGoogleSignIn();

      expect(res.statusCode).toBe(302);
      const location = new URL(res.headers.location as string);
      expect(`${location.origin}${location.pathname}`).toBe(`${FRONTEND}/auth/callback`);
      expect(location.searchParams.get('token')).toBeNull();
      expect(location.searchParams.get('code')).toMatch(/^[a-f0-9]{64}$/);
      expect(res.headers.location).not.toMatch(/eyJ/);
    });

    it('sets the login nonce as an HttpOnly, SameSite=Lax cookie scoped to the exchange', async () => {
      const res = await completeGoogleSignIn();

      const cookie = (res.cookies as CookieLike[]).find((c) => c.name === NONCE_COOKIE);
      expect(cookie).toBeDefined();
      expect(cookie!.value).toMatch(/^[a-f0-9]{64}$/);
      expect(cookie!.httpOnly).toBe(true);
      expect(cookie!.sameSite).toBe('Lax');
      expect(cookie!.path).toBe('/auth/exchange');
      expect(cookie!.maxAge).toBe(60);
      // Secure only in production, so local http development keeps working.
      expect(cookie!.secure).toBeFalsy();
    });

    it('lets the same browser swap the code for a session', async () => {
      const res = await completeGoogleSignIn();
      const code = new URL(res.headers.location as string).searchParams.get('code')!;
      const nonce = (res.cookies as CookieLike[]).find((c) => c.name === NONCE_COOKIE)!.value;
      vi.unstubAllGlobals();

      const swapped = await exchange(app, code, nonce);
      expect(swapped.statusCode).toBe(200);
      const me = await app.inject({
        method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${swapped.json().token}` },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json().email).toBe(EMAIL);
    });
  });

  describe('POST /auth/exchange', () => {
    it('refuses a code without the nonce cookie of the browser it was issued to (login CSRF)', async () => {
      const { code } = await createLoginExchangeCode(await signedInUser());

      expect((await exchange(app, code)).statusCode).toBe(400);
      const other = await createLoginExchangeCode(await signedInUser());
      const res = await exchange(app, code, other.nonce);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_CODE');
    });

    it('does not burn the code when the nonce is wrong', async () => {
      const { code, nonce } = await createLoginExchangeCode(await signedInUser());
      await exchange(app, code, 'f'.repeat(64));

      expect((await exchange(app, code, nonce)).statusCode).toBe(200);
    });

    it('is single use', async () => {
      const { code, nonce } = await createLoginExchangeCode(await signedInUser());

      expect((await exchange(app, code, nonce)).statusCode).toBe(200);
      expect((await exchange(app, code, nonce)).statusCode).toBe(400);
    });

    it('clears the nonce cookie once the code is used', async () => {
      const { code, nonce } = await createLoginExchangeCode(await signedInUser());
      const res = await exchange(app, code, nonce);

      const cleared = (res.cookies as CookieLike[]).find((c) => c.name === NONCE_COOKIE);
      expect(cleared?.value).toBe('');
      expect(cleared?.path).toBe('/auth/exchange');
    });

    it('rejects an expired code', async () => {
      const { code, nonce } = await createLoginExchangeCode(await signedInUser());
      await getSql()`UPDATE login_exchange_codes SET expires_at = NOW() - INTERVAL '1 second'`;

      expect((await exchange(app, code, nonce)).statusCode).toBe(400);
    });

    it('rejects a code issued before the account revoked its sessions', async () => {
      const user = await signedInUser();
      const { code, nonce } = await createLoginExchangeCode(user);
      await getSql()`UPDATE users SET token_version = token_version + 1 WHERE id = ${user.id}`;

      expect((await exchange(app, code, nonce)).statusCode).toBe(400);
    });

    it('stores only hashes of the code and nonce', async () => {
      const { code, nonce } = await createLoginExchangeCode(await signedInUser());
      const rows = await getSql()`
        SELECT 1 FROM login_exchange_codes WHERE code_hash = ${code} OR nonce_hash = ${nonce}
      `;
      expect(rows).toHaveLength(0);
    });

    it('lets the web origin send the cookie (credentialed CORS), and only the web origin', async () => {
      const allowed = await app.inject({
        method: 'OPTIONS', url: '/auth/exchange',
        headers: { origin: FRONTEND, 'access-control-request-method': 'POST' },
      });
      expect(allowed.headers['access-control-allow-origin']).toBe(FRONTEND);
      expect(allowed.headers['access-control-allow-credentials']).toBe('true');

      const other = await app.inject({
        method: 'OPTIONS', url: '/auth/exchange',
        headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
      });
      expect(other.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });
});
