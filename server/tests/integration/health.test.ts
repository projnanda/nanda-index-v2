import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';

/**
 * Integration test for GET /health.
 * Requires:
 *   - Docker Postgres up (npm run dev / docker compose up -d --wait)
 *   - .env loaded with DATABASE_URL + SIGNING_PRIVATE_KEY
 *     (npm test loads .env via NODE_OPTIONS=--env-file=.env)
 *
 * Uses fastify.inject() to dispatch HTTP without binding a port.
 */
describe('GET /health', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('returns 200 with status=ok and db=ok when Postgres is reachable', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
  });
});
