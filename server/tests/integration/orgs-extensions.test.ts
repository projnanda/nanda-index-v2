import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';
import { upsertUser } from '../../src/db/queries/users.js';

/**
 * The defect this covers was found at the API, not in a unit: a registrant
 * POSTed an invented namespace carrying `javascript:` and got 201, after which
 * the index served it on `/api/v1/index/:org_id`, `/api/v1/search` and
 * `/api/v1/resolve`. These tests assert the route refuses it, so a future
 * refactor that stops calling the validator is caught here even if the unit
 * tests still pass.
 */
const ORG_PREFIX = 'extval-';

describe('POST/PUT /api/v1/orgs — extension content', () => {
  let fastify: FastifyInstance;
  let token: string;
  let userId: string;

  const body = (orgId: string, extensions: unknown) => ({
    org_id: orgId,
    display_name: 'Extension Validation',
    domain: `${orgId}.example.com`,
    contact_email: `a@${orgId}.example.com`,
    registry_url: `https://${orgId}.example.com/r`,
    extensions,
  });

  const readAsOwner = (orgId: string) =>
    fastify.inject({
      method: 'GET',
      url: `/api/v1/orgs/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
    });

  const post = (orgId: string, extensions: unknown) =>
    fastify.inject({
      method: 'POST',
      url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: body(orgId, extensions),
    });

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();
    const user = await upsertUser({
      email: 'extval-test@example.com',
      displayName: 'Ext Val Test',
      avatarUrl: null,
      provider: 'google',
      providerId: 'extval-test-provider-id',
      emailVerified: true,
    });
    userId = user.id;
    token = fastify.jwt.sign({ userId, email: user.email, displayName: null });
  });

  afterAll(async () => {
    const sql = getSql();
    await sql`DELETE FROM org_memberships WHERE org_id LIKE ${ORG_PREFIX + '%'}`;
    await sql`DELETE FROM organizations WHERE org_id LIKE ${ORG_PREFIX + '%'}`;
    await sql`DELETE FROM users WHERE id = ${userId}`;
    await fastify.close();
  });

  it('refuses an invented namespace carrying a javascript: URL', async () => {
    const res = await post(`${ORG_PREFIX}evil`, { 'com.evil': { url: 'javascript:alert(1)' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toMatch(/extensions\.com\.evil\.url/);
  });

  it('does not create the entry when it refuses', async () => {
    // A 400 that still wrote the row would publish the payload anyway, so this
    // asks the database directly. Neither HTTP route can answer it: on an
    // entry that does not exist, /api/v1/index returns 404 exactly as it does
    // for a pending one, and /api/v1/orgs returns 403 because membership is
    // checked before existence — both deliberate, and both would let this
    // assertion pass without proving anything.
    const orgId = `${ORG_PREFIX}notcreated`;
    await post(orgId, { 'com.evil': { url: 'javascript:alert(1)' } });

    const sql = getSql();
    const rows = await sql`SELECT 1 FROM organizations WHERE org_id = ${orgId}`;
    expect(rows).toHaveLength(0);
  });

  it('still accepts a registrant’s own namespace with ordinary content', async () => {
    const res = await post(`${ORG_PREFIX}ok`, {
      'com.example': { did: 'did:web:example.com', mcp: 'https://example.com/mcp' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().extensions['com.example']).toEqual({
      did: 'did:web:example.com',
      mcp: 'https://example.com/mcp',
    });
  });

  it('refuses the same payload on update, on an entry that was fine before', async () => {
    const orgId = `${ORG_PREFIX}update`;
    expect((await post(orgId, { 'com.example': { note: 'fine' } })).statusCode).toBe(201);

    const res = await fastify.inject({
      method: 'PUT',
      url: `/api/v1/orgs/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        display_name: 'Extension Validation',
        registry_url: `https://${orgId}.example.com/r`,
        extensions: { 'com.example': { note: 'data:text/html,<script>alert(1)</script>' } },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('leaves the entry as it was after a refused update', async () => {
    const orgId = `${ORG_PREFIX}update`;
    const read = await readAsOwner(orgId);
    expect(read.statusCode).toBe(200);
    expect(read.json().extensions['com.example']).toEqual({ note: 'fine' });
  });
});
