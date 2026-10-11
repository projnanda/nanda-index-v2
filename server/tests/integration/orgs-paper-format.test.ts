import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';
import { upsertUser } from '../../src/db/queries/users.js';

const NANDA = 'org.projectnanda';

describe('Org registration — paper-format index records', () => {
  let fastify: FastifyInstance;
  let token: string;

  const create = (payload: Record<string, unknown>) =>
    fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

  const update = (orgId: string, payload: Record<string, unknown>) =>
    fastify.inject({
      method: 'PUT', url: `/api/v1/orgs/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();
    const user = await upsertUser({
      email: 'pf-test@example.com', displayName: null, avatarUrl: null,
      provider: 'google', providerId: 'pf-test-provider-id',
    });
    token = fastify.jwt.sign({ userId: user.id, email: user.email, displayName: null });
  });

  afterAll(async () => {
    await fastify.close();
    const { closeSql } = await import('../../src/db/client.js');
    await closeSql();
  });

  beforeEach(async () => {
    const sql = getSql();
    await sql`DELETE FROM organizations WHERE org_id LIKE 'pf-%'`;
  });

  it('registry path: catalog-root identifier, bare-domain publisher, namespaced extensions', async () => {
    const res = await create({
      org_id: 'pf-example', display_name: 'Example.com', domain: 'pf-example.com',
      contact_email: 'ai@pf-example.com', registry_url: 'https://pf-example.com/.well-known/ai-catalog.json',
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.identifier).toBe('urn:air:pf-example.com:catalog:root');
    expect(body.media_type).toBe('application/ai-catalog+json');
    expect(body.publisher).toEqual({ identifier: 'pf-example.com', displayName: 'Example.com', identityType: 'dns' });
    expect(body.extensions).toEqual({
      [NANDA]: { resolutionRole: 'nested-ai-catalog', preferredDiscovery: 'ai-catalog', nandaIndexRole: 'optional-fallback-entry' },
    });
    expect(body).not.toHaveProperty('metadata');
  });

  it('personal path: host39-anchored identifier with the email as subjectAccount', async () => {
    const res = await create({
      org_id: 'pf-john', display_name: "John's Personal Agent", hosting_path: 'personal',
      contact_email: 'pf-john@hotmail.com',
      registry_url: 'https://agentcards.host39.org/personal/pf-john@hotmail.com/card.json',
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.identifier).toBe('urn:air:host39.org:personal:pf-john@hotmail.com');
    expect(body.publisher).toEqual({ identifier: 'host39.org', displayName: 'Host39', identityType: 'dns' });
    expect(body.extensions[NANDA]).toMatchObject({
      resolutionRole: 'personal-agent-card', subjectAccount: 'pf-john@hotmail.com', agentCardHost: 'host39.org',
    });
  });

  it('personal path: a blank domain is stored as no domain, never as an empty anchor', async () => {
    const res = await create({
      org_id: 'pf-blank', display_name: 'Blank Domain Agent', hosting_path: 'personal', domain: '',
      contact_email: 'pf-blank@gmail.com',
      registry_url: 'https://agentcards.host39.org/personal/pf-blank@gmail.com/card.json',
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().identifier).toBe('urn:air:host39.org:personal:pf-blank@gmail.com');
    const [row] = await getSql()<{ domain: string | null }[]>`SELECT domain FROM organizations WHERE org_id = 'pf-blank'`;
    expect(row?.domain).toBeNull();
  });

  it('smb path: a blank domain is rejected rather than stored', async () => {
    const res = await create({
      org_id: 'pf-blank-smb', display_name: 'Blank SMB', hosting_path: 'smb', domain: '',
      contact_email: 'owner@pf-blank-smb.com', registry_url: 'https://agentcards.host39.org/pf-blank-smb/card.json',
    });

    expect(res.statusCode).toBe(400);
  });

  it('dns-svcb path: A2A card entry whose server-owned roles cannot be spoofed', async () => {
    const res = await create({
      org_id: 'pf-refunds', display_name: 'SkyBlue Refunds Agent', hosting_path: 'dns-svcb',
      domain: 'pf-skyblue.com', contact_email: 'agents@pf-skyblue.com',
      registry_url: 'https://api.pf-skyblue.com/agents/refunds.json',
      extensions: { [NANDA]: { resolutionRole: 'nested-ai-catalog', 'auth.execution': 'oauth' } },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.identifier).toBe('urn:air:pf-skyblue.com:agent:pf-refunds');
    expect(body.media_type).toBe('application/a2a-agent-card+json');
    expect(body.extensions[NANDA]).toEqual({
      resolutionRole: 'dns-svcb-pointer',
      preferredDiscovery: 'dns-svcb',
      authoritativeSystem: 'pf-skyblue.com DNS',
      nandaIndexRole: 'federated-pointer',
      'auth.execution': 'oauth',
    });
  });

  it('rejects an identifier anchored to a domain the registrant did not register', async () => {
    const res = await create({
      org_id: 'pf-squat', display_name: 'Squatter', hosting_path: 'smb', domain: 'pf-squat.com',
      contact_email: 'x@pf-squat.com', registry_url: 'https://pf-squat.com/card.json',
      identifier: 'urn:air:skyblue.com:agent:refunds',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects the retired dns-aid hosting path and media type', async () => {
    const base = {
      org_id: 'pf-old', display_name: 'Old', domain: 'pf-old.com',
      contact_email: 'x@pf-old.com', registry_url: 'https://pf-old.com/card.json',
    };
    expect((await create({ ...base, hosting_path: 'dns-aid' })).statusCode).toBe(400);
    expect((await create({ ...base, media_type: 'application/vnd.dns-aid+json' })).statusCode).toBe(400);
  });

  it('rejects a domain already held by another entry with 409', async () => {
    const payload = {
      display_name: 'Bakery', hosting_path: 'smb', domain: 'pf-bakery.com',
      contact_email: 'x@pf-bakery.com', registry_url: 'https://agentcards.host39.org/pf-bakery/orders.json',
    };
    expect((await create({ ...payload, org_id: 'pf-orders' })).statusCode).toBe(201);
    expect((await create({ ...payload, org_id: 'pf-orders-2' })).statusCode).toBe(409);
  });

  describe('abandoned personal registrations do not hold an identifier hostage', () => {
    const personal = (orgId: string, email: string) => create({
      org_id: orgId, display_name: 'Personal', hosting_path: 'personal',
      contact_email: email, registry_url: `https://agentcards.host39.org/personal/${email}/card.json`,
    });

    it('releases an unverified registration whose verification link has expired', async () => {
      expect((await personal('pf-squatter', 'pf-victim@corp.example')).statusCode).toBe(201);
      await getSql()`UPDATE organizations SET verify_token_expires_at = NOW() - INTERVAL '1 minute' WHERE org_id = 'pf-squatter'`;

      const res = await personal('pf-owner', 'pf-victim@corp.example');

      expect(res.statusCode).toBe(201);
      expect(res.json().identifier).toBe('urn:air:host39.org:personal:pf-victim@corp.example');
      const left = await getSql()`SELECT org_id FROM organizations WHERE org_id = 'pf-squatter'`;
      expect(left).toHaveLength(0);
    });

    it('still blocks while the verification link is valid', async () => {
      expect((await personal('pf-first', 'pf-pending@corp.example')).statusCode).toBe(201);
      expect((await personal('pf-second', 'pf-pending@corp.example')).statusCode).toBe(409);
    });

    it('still blocks once the email has been verified', async () => {
      expect((await personal('pf-verified', 'pf-done@corp.example')).statusCode).toBe(201);
      await getSql()`UPDATE organizations SET email_verified = true, status = 'active', verify_token_expires_at = NOW() - INTERVAL '1 day' WHERE org_id = 'pf-verified'`;
      expect((await personal('pf-late', 'pf-done@corp.example')).statusCode).toBe(409);
    });
  });

  it('PUT re-anchors identifier and publisher when the domain changes', async () => {
    await create({
      org_id: 'pf-move', display_name: 'Mover', hosting_path: 'smb', domain: 'pf-move-old.com',
      contact_email: 'x@pf-move-old.com', registry_url: 'https://agentcards.host39.org/pf-move/card.json',
    });

    const res = await update('pf-move', { domain: 'pf-move-new.com' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.identifier).toBe('urn:air:pf-move-new.com:agent:pf-move');
    expect(body.publisher.identifier).toBe('pf-move-new.com');
    expect(body.domain_verified).toBe(false);
  });

  it('suspend → PUT unowned domain → reactivate does not put the entry live', async () => {
    await create({
      org_id: 'pf-swap', display_name: 'Swap', hosting_path: 'smb', domain: 'pf-swap.com',
      contact_email: 'x@pf-swap.com', registry_url: 'https://agentcards.host39.org/pf-swap/card.json',
    });
    const sql = getSql();
    await sql`UPDATE organizations SET status = 'active', domain_verified = true WHERE org_id = 'pf-swap'`;

    const auth = { authorization: `Bearer ${token}` };
    await fastify.inject({ method: 'DELETE', url: '/api/v1/orgs/pf-swap/suspend', headers: auth });
    await update('pf-swap', { domain: 'pf-victim.com' });
    const reactivated = await fastify.inject({ method: 'POST', url: '/api/v1/orgs/pf-swap/reactivate', headers: auth });

    expect(reactivated.json().status).toBe('pending');
    const resolved = await fastify.inject({
      method: 'GET', url: `/api/v1/resolve?locator=${encodeURIComponent('urn:air:pf-victim.com:agent:pf-swap')}`,
    });
    expect(resolved.statusCode).toBe(404);
  });

  it('PUT rejects fields that cannot be changed, naming them, and changes nothing', async () => {
    await create({
      org_id: 'pf-strict', display_name: 'Strict', hosting_path: 'smb', domain: 'pf-strict.com',
      contact_email: 'x@pf-strict.com', registry_url: 'https://agentcards.host39.org/pf-strict/card.json',
    });

    const res = await update('pf-strict', {
      description: 'new description',
      contact_email: 'attacker@evil.com',
      identifier: 'urn:air:pf-strict.com:agent:other',
      descripton: 'typo',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('UNKNOWN_FIELDS');
    expect(res.json().detail).toContain('contact_email');
    expect(res.json().detail).toContain('identifier');
    expect(res.json().detail).toContain('descripton');
    const after = await fastify.inject({ method: 'GET', url: '/api/v1/orgs/pf-strict', headers: { authorization: `Bearer ${token}` } });
    expect(after.json().description).not.toBe('new description');
  });

  it('PUT rejects unknown publisher keys — only displayName is editable', async () => {
    await create({
      org_id: 'pf-pub', display_name: 'Pub', hosting_path: 'smb', domain: 'pf-pub.com',
      contact_email: 'x@pf-pub.com', registry_url: 'https://agentcards.host39.org/pf-pub/card.json',
    });

    const rejected = await update('pf-pub', { publisher: { identifier: 'evil.com', displayName: 'Pub' } });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().detail).toContain('publisher.identifier');

    const ok = await update('pf-pub', { publisher: { displayName: 'Pub Inc' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().publisher).toEqual({ identifier: 'pf-pub.com', displayName: 'Pub Inc', identityType: 'dns' });
  });

  it('PUT replaces client extensions but keeps the server-owned roles', async () => {
    await create({
      org_id: 'pf-ext', display_name: 'Ext', hosting_path: 'smb', domain: 'pf-ext.com',
      contact_email: 'x@pf-ext.com', registry_url: 'https://agentcards.host39.org/pf-ext/card.json',
    });

    const res = await update('pf-ext', {
      extensions: { [NANDA]: { resolutionRole: 'spoofed', 'runtime.provider': 'GCP' }, 'com.example': { tier: 'gold' } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().extensions).toEqual({
      [NANDA]: { resolutionRole: 'smb-agent-card', preferredDiscovery: 'nandaindex', 'runtime.provider': 'GCP' },
      'com.example': { tier: 'gold' },
    });
  });
});
