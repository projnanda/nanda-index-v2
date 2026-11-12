import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { closeSql } from '../../src/db/client.js';

/**
 * Every error the API returns uses one envelope: `{ error: CODE, detail }`,
 * with optional additive fields (`field` for validation errors). These cover
 * the responses produced outside route handlers: schema validation, unknown
 * routes, malformed JSON and the rate limiter.
 */
const ENVELOPE_KEYS = ['detail', 'endpoint', 'error', 'field'];
const CODE = /^[A-Za-z_]+$/;

function expectEnvelope(body: Record<string, unknown>): void {
  expect(Object.keys(body).every((key) => ENVELOPE_KEYS.includes(key))).toBe(true);
  expect(body.error).toMatch(CODE);
  expect(typeof body.detail).toBe('string');
}

let app: FastifyInstance;
let limited: FastifyInstance;

beforeAll(async () => {
  app = (await buildServer({ logger: false })).fastify;
  const saved = process.env.AUTH_RATE_LIMIT_MAX;
  process.env.AUTH_RATE_LIMIT_MAX = '1';
  limited = (await buildServer({ logger: false })).fastify;
  process.env.AUTH_RATE_LIMIT_MAX = saved;
  await Promise.all([app.ready(), limited.ready()]);
});

afterAll(async () => {
  await Promise.all([app.close(), limited.close()]);
  await closeSql();
});

describe('error envelope', () => {
  it('answers an unknown route with not_found in the envelope', async () => {
    const res = await app.inject({ url: '/no/such/route' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found', detail: 'route not found' });
  });

  it('reports a missing body property with the field it names', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'x' } });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expectEnvelope(body);
    expect(body).toEqual({
      error: 'FST_ERR_VALIDATION',
      field: 'email',
      detail: "body must have required property 'email'",
    });
  });

  it('reports an invalid body property with its path as field', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 42, password: 'x'.repeat(1000) } });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expectEnvelope(body);
    expect(body.error).toBe('FST_ERR_VALIDATION');
    expect(typeof body.field).toBe('string');
    expect(body.detail.startsWith(`body/${body.field}`)).toBe(true);
  });

  it('answers malformed JSON in the envelope', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/login',
      headers: { 'content-type': 'application/json' }, payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expectEnvelope(res.json());
    expect(res.json().error).toBe('FST_ERR_CTP_INVALID_JSON_BODY');
  });

  it('answers a rate-limited request with a RATE_LIMITED code and the wait in detail', async () => {
    const login = () => limited.inject({
      method: 'POST', url: '/auth/login', remoteAddress: '10.77.0.1',
      payload: { email: 'envelope-limit@example.com', password: 'wrong-password' },
    });
    expect((await login()).statusCode).not.toBe(429);
    const res = await login();
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    const body = res.json();
    expectEnvelope(body);
    expect(body.error).toBe('RATE_LIMITED');
    expect(body.detail).toMatch(/^Rate limit exceeded, retry in /);
  });
});
