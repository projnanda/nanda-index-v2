import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';

describe('GET /docs/json — OpenAPI spec', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('serves a valid OpenAPI 3 document with NANDA Index routes', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);

    const spec = res.json() as { openapi: string; info: { title: string }; paths: Record<string, unknown> };
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBe('NANDA Index Server');

    // Core v2 endpoints must be present
    expect(spec.paths['/health']).toBeDefined();
    expect(spec.paths['/api/v1/index']).toBeDefined();
    expect(spec.paths['/api/v1/index/{org_id}']).toBeDefined();
    expect(spec.paths['/api/v1/orgs']).toBeDefined();
    expect(spec.paths['/api/v1/resolve']).toBeDefined();
    expect(spec.paths['/api/v1/search']).toBeDefined();
  });

  it('documents ttl_seconds as a resolver cache hint, not a listing lifetime', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/docs/json' });
    type Schema = { properties: Record<string, { description?: string }> };
    type Op = { responses: Record<string, { content: Record<string, { schema: Schema }> }> };
    const spec = res.json() as { paths: Record<string, Record<string, Op>> };
    const ownerGet = spec.paths['/api/v1/orgs/{org_id}']?.['get'];
    const ttl = ownerGet?.responses['200']?.content['application/json']?.schema.properties['ttl_seconds'];
    expect(ttl?.description).toMatch(/cache/i);
    expect(ttl?.description).toMatch(/does not expire/i);
  });
});
