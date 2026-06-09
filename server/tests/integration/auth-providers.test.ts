import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';

describe('GET /auth/providers', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
    const { closeSql } = await import('../../src/db/client.js');
    await closeSql();
  });

  it('returns 200 with google and github boolean flags', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/auth/providers' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.google).toBe('boolean');
    expect(typeof body.github).toBe('boolean');
  });

  it('returns false for unconfigured providers in test env', async () => {
    // In test env GOOGLE_CLIENT_ID / GITHUB_CLIENT_ID are not set, so both must be false
    const res = await fastify.inject({ method: 'GET', url: '/auth/providers' });
    const body = res.json();
    expect(body.google).toBe(false);
    expect(body.github).toBe(false);
  });
});
