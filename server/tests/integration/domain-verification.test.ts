import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Mock Node DNS so the verifier's resolver is deterministic in tests.
// vi.hoisted lets the (hoisted) vi.mock factory reference the spy safely.
const { resolveTxtMock } = vi.hoisted(() => ({ resolveTxtMock: vi.fn() }));
// Every resolver verification asks — the host's and each public one — answers
// with the same spy, so a test states one DNS truth and all resolvers see it.
vi.mock('node:dns/promises', () => ({
  resolveTxt: resolveTxtMock,
  Resolver: class {
    setServers(): void {}
    resolveTxt(name: string) { return resolveTxtMock(name); }
  },
}));

import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';
import { upsertUser } from '../../src/db/queries/users.js';

async function createOrg(fastify: FastifyInstance, token: string, orgId: string): Promise<void> {
  await fastify.inject({
    method: 'POST', url: '/api/v1/orgs',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      org_id:        orgId,
      display_name:  'Domain Test',
      domain:        `${orgId}.example.com`,
      contact_email: `admin@${orgId}.example.com`,
      registry_url:  `https://${orgId}.example.com/r`,
    },
  });
}

async function addMember(orgId: string, userId: string, role: 'admin' | 'member'): Promise<void> {
  const sql = getSql();
  await sql`INSERT INTO org_memberships (user_id, org_id, role) VALUES (${userId}, ${orgId}, ${role})`;
}

async function requestChallenge(fastify: FastifyInstance, token: string, orgId: string, remoteAddress?: string) {
  return fastify.inject({
    method: 'POST', url: `/api/v1/orgs/${orgId}/domain-challenge`,
    headers: { authorization: `Bearer ${token}` },
    remoteAddress,
  });
}

async function verifyDomain(fastify: FastifyInstance, token: string, orgId: string, remoteAddress?: string) {
  return fastify.inject({
    method: 'POST', url: `/api/v1/orgs/${orgId}/verify-domain`,
    headers: { authorization: `Bearer ${token}` },
    remoteAddress,
  });
}

describe('Domain ownership verification — DNS TXT challenge', () => {
  let fastify: FastifyInstance;
  let adminToken: string;
  let memberUserId: string;
  let memberToken: string;

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();

    const admin = await upsertUser({
      email: 'dv-admin@example.com', displayName: 'DV Admin', avatarUrl: null,
      provider: 'google', providerId: 'dv-admin-id', emailVerified: true,
    });
    adminToken = fastify.jwt.sign({ userId: admin.id, email: admin.email, displayName: null });

    const member = await upsertUser({
      email: 'dv-member@example.com', displayName: 'DV Member', avatarUrl: null,
      provider: 'github', providerId: 'dv-member-id', emailVerified: true,
    });
    memberUserId = member.id;
    memberToken = fastify.jwt.sign({ userId: member.id, email: member.email, displayName: null });
  });

  afterAll(async () => {
    await fastify.close();
    const { closeSql } = await import('../../src/db/client.js');
    await closeSql();
  });

  beforeEach(async () => {
    resolveTxtMock.mockReset();
    const sql = getSql();
    await sql`DELETE FROM org_memberships USING organizations
              WHERE org_memberships.org_id = organizations.org_id
              AND organizations.org_id LIKE 'dv-%'`;
    await sql`DELETE FROM organizations WHERE org_id LIKE 'dv-%'`;
  });

  // ── POST /domain-challenge ───────────────────────────────────────────────────

  it('issues a challenge with the correct TXT record name and value', async () => {
    await createOrg(fastify, adminToken, 'dv-chal');

    const res = await requestChallenge(fastify, adminToken, 'dv-chal');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.domain).toBe('dv-chal.example.com');
    expect(body.record_name).toBe('_nanda-challenge.dv-chal.example.com');
    expect(body.record_type).toBe('TXT');
    expect(body.record_value).toMatch(/^nanda-verify=[a-f0-9]{64}$/);
    expect(typeof body.expires_at).toBe('string');
  });

  it('forbids a non-admin member from requesting a challenge (403)', async () => {
    await createOrg(fastify, adminToken, 'dv-chal-role');
    await addMember('dv-chal-role', memberUserId, 'member');

    const res = await requestChallenge(fastify, memberToken, 'dv-chal-role');
    expect(res.statusCode).toBe(403);
  });

  // ── Re-requesting returns the outstanding challenge ──────────────────────────

  it('returns the same unexpired challenge on repeat requests instead of rotating it', async () => {
    await createOrg(fastify, adminToken, 'dv-reuse');

    const first = (await requestChallenge(fastify, adminToken, 'dv-reuse')).json();
    const second = (await requestChallenge(fastify, adminToken, 'dv-reuse')).json();

    expect(second.record_value).toBe(first.record_value);
    expect(second.expires_at).toBe(first.expires_at);
  });

  it('verifies against the record published before the page was reloaded', async () => {
    await createOrg(fastify, adminToken, 'dv-reload');
    const published = (await requestChallenge(fastify, adminToken, 'dv-reload')).json();
    resolveTxtMock.mockResolvedValue([[published.record_value]]);

    // The user comes back after editing DNS; the page asks for the challenge again.
    await requestChallenge(fastify, adminToken, 'dv-reload');

    const res = await verifyDomain(fastify, adminToken, 'dv-reload');
    expect(res.statusCode).toBe(200);
    expect(res.json().domain_verified).toBe(true);
  });

  it('issues a fresh challenge once the previous one has expired', async () => {
    await createOrg(fastify, adminToken, 'dv-expired');
    const stale = (await requestChallenge(fastify, adminToken, 'dv-expired')).json();
    await getSql()`UPDATE organizations SET domain_challenge_expires_at = NOW() - INTERVAL '1 minute'
                   WHERE org_id = 'dv-expired'`;

    const fresh = (await requestChallenge(fastify, adminToken, 'dv-expired')).json();

    expect(fresh.record_value).not.toBe(stale.record_value);
    expect(new Date(fresh.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('hands concurrent requests the same challenge', async () => {
    await createOrg(fastify, adminToken, 'dv-race');

    const responses = await Promise.all([
      requestChallenge(fastify, adminToken, 'dv-race'),
      requestChallenge(fastify, adminToken, 'dv-race'),
      requestChallenge(fastify, adminToken, 'dv-race'),
    ]);
    const values = new Set(responses.map((r) => r.json().record_value));

    expect(values.size).toBe(1);
  });

  it('issues a challenge for the new domain after the domain is changed', async () => {
    await createOrg(fastify, adminToken, 'dv-moved');
    const old = (await requestChallenge(fastify, adminToken, 'dv-moved')).json();
    await fastify.inject({
      method: 'PUT', url: '/api/v1/orgs/dv-moved',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { domain: 'dv-moved-new.example.com' },
    });

    const next = (await requestChallenge(fastify, adminToken, 'dv-moved')).json();

    expect(next.record_name).toBe('_nanda-challenge.dv-moved-new.example.com');
    expect(next.record_value).not.toBe(old.record_value);
  });

  // ── POST /verify-domain ──────────────────────────────────────────────────────

  it('verifies the domain and activates the org when the TXT record matches', async () => {
    await createOrg(fastify, adminToken, 'dv-ok');
    const chal = (await requestChallenge(fastify, adminToken, 'dv-ok')).json();

    // DNS now returns the exact challenge value.
    resolveTxtMock.mockResolvedValue([[chal.record_value]]);

    const res = await verifyDomain(fastify, adminToken, 'dv-ok');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.domain_verified).toBe(true);
    expect(body.status).toBe('active');
    expect(resolveTxtMock).toHaveBeenCalledWith('_nanda-challenge.dv-ok.example.com');
  });

  it('rejects verification when the TXT record is absent and leaves org pending', async () => {
    await createOrg(fastify, adminToken, 'dv-missing');
    await requestChallenge(fastify, adminToken, 'dv-missing');

    // Domain has no challenge record yet.
    resolveTxtMock.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }));

    const res = await verifyDomain(fastify, adminToken, 'dv-missing');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('DOMAIN_NOT_VERIFIED');

    const after = (await fastify.inject({
      method: 'GET', url: '/api/v1/orgs/dv-missing',
      headers: { authorization: `Bearer ${adminToken}` },
    })).json();
    expect(after.domain_verified).toBe(false);
    expect(after.status).toBe('pending');
  });

  it('rejects verification when a different TXT value is present', async () => {
    await createOrg(fastify, adminToken, 'dv-wrong');
    await requestChallenge(fastify, adminToken, 'dv-wrong');

    resolveTxtMock.mockResolvedValue([['nanda-verify=some-other-token'], ['v=spf1 ~all']]);

    const res = await verifyDomain(fastify, adminToken, 'dv-wrong');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('DOMAIN_NOT_VERIFIED');
  });

  it('returns 400 when verifying without an active challenge', async () => {
    await createOrg(fastify, adminToken, 'dv-nochal');

    const res = await verifyDomain(fastify, adminToken, 'dv-nochal');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('NO_ACTIVE_CHALLENGE');
    expect(resolveTxtMock).not.toHaveBeenCalled();
  });

  it('forbids a non-admin member from verifying the domain (403)', async () => {
    await createOrg(fastify, adminToken, 'dv-verify-role');
    await addMember('dv-verify-role', memberUserId, 'member');

    const res = await verifyDomain(fastify, memberToken, 'dv-verify-role');
    expect(res.statusCode).toBe(403);
    expect(resolveTxtMock).not.toHaveBeenCalled();
  });

  it('forbids a non-member from requesting a challenge (403)', async () => {
    await createOrg(fastify, adminToken, 'dv-nonmember');

    const res = await requestChallenge(fastify, memberToken, 'dv-nonmember');
    expect(res.statusCode).toBe(403);
  });

  it('refuses a challenge for a personal org, which has no domain to prove (400)', async () => {
    await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        org_id: 'dv-personal', display_name: 'Personal', hosting_path: 'personal',
        contact_email: 'dv-personal@example.com',
        registry_url: 'https://agentcards.host39.org/personal/dv-personal@example.com/card.json',
      },
    });

    const res = await requestChallenge(fastify, adminToken, 'dv-personal');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('NO_DOMAIN');
  });

  // ── A domain change during the DNS lookup cannot verify the new domain ───────

  it('refuses to verify a domain swapped in while the DNS lookup was pending (409)', async () => {
    // The victim holds an unproven claim on their own domain.
    await createOrg(fastify, memberToken, 'dv-victim');
    await createOrg(fastify, adminToken, 'dv-attacker');
    const chal = (await requestChallenge(fastify, adminToken, 'dv-attacker')).json();

    // DNS answers for the attacker's own domain, but only when the test says so.
    let release!: () => void;
    const answer = new Promise<string[][]>((resolve) => { release = () => resolve([[chal.record_value]]); });
    let lookupStarted!: () => void;
    const started = new Promise<void>((resolve) => { lookupStarted = resolve; });
    resolveTxtMock.mockImplementation(() => { lookupStarted(); return answer; });

    const verifying = verifyDomain(fastify, adminToken, 'dv-attacker');
    await started;
    const swap = await fastify.inject({
      method: 'PUT', url: '/api/v1/orgs/dv-attacker',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { domain: 'dv-victim.example.com' },
    });
    expect(swap.statusCode).toBe(200);
    release();
    const res = await verifying;

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('DOMAIN_CHANGED');
    const [attacker] = await getSql()<{ domain: string; domainVerified: boolean; status: string }[]>`
      SELECT domain, domain_verified, status FROM organizations WHERE org_id = 'dv-attacker'`;
    expect(attacker).toEqual({ domain: 'dv-victim.example.com', domainVerified: false, status: 'pending' });
    const victim = await getSql()`SELECT org_id FROM organizations WHERE org_id = 'dv-victim'`;
    expect(victim).toHaveLength(1);
  });

  it('refuses a proof whose challenge was replaced while the DNS lookup was pending (409)', async () => {
    await createOrg(fastify, adminToken, 'dv-rechal');
    const chal = (await requestChallenge(fastify, adminToken, 'dv-rechal')).json();

    let release!: () => void;
    const answer = new Promise<string[][]>((resolve) => { release = () => resolve([[chal.record_value]]); });
    let lookupStarted!: () => void;
    const started = new Promise<void>((resolve) => { lookupStarted = resolve; });
    resolveTxtMock.mockImplementation(() => { lookupStarted(); return answer; });

    const verifying = verifyDomain(fastify, adminToken, 'dv-rechal');
    await started;
    await getSql()`UPDATE organizations SET domain_challenge = 'replaced' WHERE org_id = 'dv-rechal'`;
    release();
    const res = await verifying;

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('DOMAIN_CHANGED');
    const [org] = await getSql()<{ domainVerified: boolean }[]>`
      SELECT domain_verified FROM organizations WHERE org_id = 'dv-rechal'`;
    expect(org?.domainVerified).toBe(false);
  });

  it('removes unproven claims on the verified domain only', async () => {
    await createOrg(fastify, adminToken, 'dv-winner');
    await createOrg(fastify, memberToken, 'dv-bystander');
    await getSql()`UPDATE organizations SET domain = 'dv-winner.example.com',
                   identifier = 'urn:air:dv-winner.example.com:catalog:squat' WHERE org_id = 'dv-bystander'`;
    await createOrg(fastify, memberToken, 'dv-other');
    const chal = (await requestChallenge(fastify, adminToken, 'dv-winner')).json();
    resolveTxtMock.mockResolvedValue([[chal.record_value]]);

    const res = await verifyDomain(fastify, adminToken, 'dv-winner');

    expect(res.statusCode).toBe(200);
    const left = await getSql()<{ orgId: string }[]>`
      SELECT org_id FROM organizations WHERE org_id IN ('dv-bystander', 'dv-other') ORDER BY org_id`;
    expect(left.map((r) => r.orgId)).toEqual(['dv-other']);
  });

  // ── Rate limits ──────────────────────────────────────────────────────────────

  it('rate-limits domain-challenge and verify-domain per client IP', async () => {
    vi.stubEnv('DOMAIN_VERIFY_RATE_LIMIT_MAX', '2');
    const limited = (await buildServer({ logger: false })).fastify;
    await limited.ready();
    try {
      await createOrg(limited, adminToken, 'dv-limited');
      resolveTxtMock.mockResolvedValue([]);
      for (const send of [requestChallenge, verifyDomain]) {
        expect((await send(limited, adminToken, 'dv-limited', '192.0.2.10')).statusCode).not.toBe(429);
        expect((await send(limited, adminToken, 'dv-limited', '192.0.2.10')).statusCode).not.toBe(429);
        expect((await send(limited, adminToken, 'dv-limited', '192.0.2.10')).statusCode).toBe(429);
        expect((await send(limited, adminToken, 'dv-limited', '192.0.2.11')).statusCode).not.toBe(429);
      }
    } finally { await limited.close(); vi.unstubAllEnvs(); }
  });

  // ── Changing the domain invalidates a prior verification ─────────────────────

  it('resets domain_verified and reverts to pending when the domain is changed', async () => {
    await createOrg(fastify, adminToken, 'dv-rotate');
    const chal = (await requestChallenge(fastify, adminToken, 'dv-rotate')).json();
    resolveTxtMock.mockResolvedValue([[chal.record_value]]);

    const verified = (await verifyDomain(fastify, adminToken, 'dv-rotate')).json();
    expect(verified.domain_verified).toBe(true);
    expect(verified.status).toBe('active');

    // Swap in a different domain the admin has NOT proven.
    const res = await fastify.inject({
      method: 'PUT', url: '/api/v1/orgs/dv-rotate',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { domain: 'someone-elses-domain.example.com' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.domain).toBe('someone-elses-domain.example.com');
    expect(body.domain_verified).toBe(false);
    expect(body.status).toBe('pending');
  });

  it('keeps domain_verified when an unrelated field is updated', async () => {
    await createOrg(fastify, adminToken, 'dv-keep');
    const chal = (await requestChallenge(fastify, adminToken, 'dv-keep')).json();
    resolveTxtMock.mockResolvedValue([[chal.record_value]]);
    await verifyDomain(fastify, adminToken, 'dv-keep');

    const res = await fastify.inject({
      method: 'PUT', url: '/api/v1/orgs/dv-keep',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { display_name: 'Renamed Co' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.display_name).toBe('Renamed Co');
    expect(body.domain_verified).toBe(true);
    expect(body.status).toBe('active');
  });
});
