import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql, closeSql } from '../../src/db/client.js';
import { upsertUser } from '../../src/db/queries/users.js';

describe('registration conflict fields', () => {
  let app: FastifyInstance;
  let token: string;
  beforeAll(async () => {
    app = (await buildServer({ logger: false })).fastify;
    await app.ready();
    const user = await upsertUser({ email: 'conflict-fields@example.com', displayName: null, avatarUrl: null, provider: 'google', providerId: 'conflict-fields', emailVerified: true });
    token = app.jwt.sign({ userId: user.id, email: user.email, displayName: null });
  });
  beforeEach(async () => { await getSql()`DELETE FROM organizations WHERE org_id LIKE 'conflict-fields-%'`; });
  afterAll(async () => { await app.close(); await closeSql(); });
  const register = (orgId: string, domain = 'conflict-fields.example.com') => app.inject({ method: 'POST', url: '/api/v1/orgs', headers: { authorization: `Bearer ${token}` }, payload: { org_id: orgId, display_name: 'Conflict Test', domain, registry_url: `https://${domain}/catalog.json`, contact_email: 'contact@example.com' } });

  it('identifies the org_id conflict', async () => {
    expect((await register('conflict-fields-same')).statusCode).toBe(201);
    const response = await register('conflict-fields-same', 'other-conflict-fields.example.com');
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'CONFLICT', field: 'org_id' });
  });
  it('identifies the domain conflict even when its derived identifier is also taken', async () => {
    await register('conflict-fields-holder');
    await getSql()`UPDATE organizations SET domain_verified = TRUE, ever_proven = TRUE, status = 'active' WHERE org_id = 'conflict-fields-holder'`;
    const response = await register('conflict-fields-new');
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'CONFLICT', field: 'domain' });
  });
  it('attributes the losing concurrent registration to the handle', async () => {
    const responses = await Promise.all([register('conflict-fields-race'), register('conflict-fields-race')]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(responses.find((r) => r.statusCode === 409)!.json()).toMatchObject({ error: 'CONFLICT', field: 'org_id' });
  });
  it('allows unproven claims on the same domain', async () => {
    expect((await register('conflict-fields-a')).statusCode).toBe(201);
    expect((await register('conflict-fields-b')).statusCode).toBe(201);
  });
});
