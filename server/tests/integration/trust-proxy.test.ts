import { describe, it, expect, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';

/**
 * Per-IP rate limits behind a reverse proxy.
 *
 * In production every request reaches the API from Caddy, so without proxy
 * trust the "client IP" is Caddy's and one visitor's failed logins lock every
 * visitor out. With one trusted hop, each visitor gets their own allowance —
 * and with none, a client cannot pick its address through X-Forwarded-For.
 */

const login = (app: FastifyInstance, forwardedFor: string, remoteAddress = '172.18.0.2' /* the proxy */) => app.inject({
  method: 'POST', url: '/auth/login',
  remoteAddress,
  headers: { 'x-forwarded-for': forwardedFor },
  payload: { email: 'nobody@example.com', password: 'wrong-password-123' },
});

async function serverWith(env: Record<string, string>): Promise<FastifyInstance> {
  Object.assign(process.env, env);
  const app = (await buildServer({ logger: false })).fastify;
  await app.ready();
  return app;
}

describe('rate limits behind a trusted proxy', () => {
  const apps: FastifyInstance[] = [];

  afterAll(async () => {
    for (const app of apps) await app.close();
    delete process.env['TRUST_PROXY_HOPS'];
    const { closeSql } = await import('../../src/db/client.js');
    await closeSql();
  });

  it('gives each visitor behind the proxy their own login allowance', async () => {
    const app = await serverWith({ TRUST_PROXY_HOPS: '1', AUTH_RATE_LIMIT_MAX: '2', AUTH_MAX_LOGIN_ATTEMPTS: '1000' });
    apps.push(app);

    await login(app, '198.51.100.1');
    await login(app, '198.51.100.1');
    expect((await login(app, '198.51.100.1')).statusCode).toBe(429);

    expect((await login(app, '198.51.100.2')).statusCode).not.toBe(429);
  });

  it('ignores X-Forwarded-For from a public peer even with a trusted hop', async () => {
    const app = await serverWith({ TRUST_PROXY_HOPS: '1', AUTH_RATE_LIMIT_MAX: '2', AUTH_MAX_LOGIN_ATTEMPTS: '1000' });
    apps.push(app);

    // A client reaching the API directly cannot rotate its address through the header.
    await login(app, '198.51.100.1', '203.0.113.9');
    await login(app, '198.51.100.2', '203.0.113.9');

    expect((await login(app, '198.51.100.3', '203.0.113.9')).statusCode).toBe(429);
  });

  it('ignores X-Forwarded-For when no proxy is trusted', async () => {
    const app = await serverWith({ TRUST_PROXY_HOPS: '0', AUTH_RATE_LIMIT_MAX: '2', AUTH_MAX_LOGIN_ATTEMPTS: '1000' });
    apps.push(app);

    await login(app, '198.51.100.1');
    await login(app, '198.51.100.2');

    expect((await login(app, '198.51.100.3')).statusCode).toBe(429);
  });
});
