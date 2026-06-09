import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { upsertUser } from '../../src/db/queries/users.js';

describe('GET /api/v1/me', () => {
  let fastify: FastifyInstance;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();

    const user = await upsertUser({
      email:       'me-test@example.com',
      displayName: 'Me Test',
      avatarUrl:   'https://example.com/avatar.png',
      provider:    'google',
      providerId:  'me-test-provider-id',
    });
    userId = user.id;
    token  = fastify.jwt.sign({ userId, email: user.email, displayName: user.displayName });
  });

  afterAll(async () => {
    await fastify.close();
    const { closeSql } = await import('../../src/db/client.js');
    await closeSql();
  });

  it('returns user profile and empty orgs array', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user_id).toBe(userId);
    expect(body.email).toBe('me-test@example.com');
    expect(body.display_name).toBe('Me Test');
    expect(Array.isArray(body.orgs)).toBe(true);
  });

  it('returns 401 without token', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with malformed token', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
  });
});
