import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { buildEntryProfile, NANDA_EXTENSION } from '../../src/lib/entryProfile.js';
import { NANDA_MEDIA_TYPES, SINGLE_RESOURCE_MEDIA_TYPES } from '../../src/lib/mediaTypes.js';

const { resolveTxtMock, sendRecoveryMock } = vi.hoisted(() => ({
  resolveTxtMock: vi.fn(), sendRecoveryMock: vi.fn(),
}));
vi.mock('node:dns/promises', () => ({
  resolveTxt: resolveTxtMock,
  Resolver: class {
    setServers(): void {}
    resolveTxt(name: string) { return resolveTxtMock(name); }
  },
}));
vi.mock('../../src/services/email.js', async (original) => ({
  ...await original<typeof import('../../src/services/email.js')>(), sendOrgRecoveryEmail: sendRecoveryMock,
}));

const { buildServer } = await import('../../src/server.js');
const { getSql, closeSql } = await import('../../src/db/client.js');
const { upsertUser } = await import('../../src/db/queries/users.js');
const { findByOrgId } = await import('../../src/db/queries/organizations.js');
const dns = await import('../../src/services/domainVerification.js');

describe('Recovery of an orphaned domain or personal entry', () => {
  let app: FastifyInstance;
  let ownerId: string;
  let otherId: string;
  let ownerToken: string;
  let otherToken: string;
  const records = new Map<string, string[]>();

  beforeAll(async () => {
    app = (await buildServer({ logger: false })).fastify;
    await app.ready();
  });
  afterAll(async () => { await app.close(); await closeSql(); });
  beforeEach(async () => {
    vi.restoreAllMocks();
    sendRecoveryMock.mockReset().mockResolvedValue(undefined);
    resolveTxtMock.mockReset();
    records.clear();
    resolveTxtMock.mockImplementation(async (name: string) => (records.get(name) ?? []).map(v => [v]));
    const sql = getSql();
    await sql`DELETE FROM organizations WHERE org_id LIKE 'recovery-%'`;
    const owner = await upsertUser({ email: 'recovery-owner@example.com', displayName: null,
      avatarUrl: null, provider: 'github', providerId: 'recovery-owner', emailVerified: true });
    const other = await upsertUser({ email: 'recovery-other@example.com', displayName: null,
      avatarUrl: null, provider: 'github', providerId: 'recovery-other', emailVerified: true });
    ownerId = owner.id; otherId = other.id;
    ownerToken = app.jwt.sign({ userId: owner.id, email: owner.email, displayName: null, tokenVersion: owner.tokenVersion });
    otherToken = app.jwt.sign({ userId: other.id, email: other.email, displayName: null, tokenVersion: other.tokenVersion });
  });

  async function seed(id: string, opts: { personal?: boolean; mediaType?: string; proven?: boolean;
    status?: string; moderation?: string; email?: string } = {}) {
    const sql = getSql();
    const domain = opts.personal ? null : `${id}.example.com`;
    const email = opts.email ?? `${id}@example.com`;
    const profile = buildEntryProfile({ path: opts.personal ? 'personal' : 'registry',
      domain, contactEmail: email, orgId: id, displayName: id, mediaType: opts.mediaType });
    await sql`INSERT INTO organizations
      (org_id, display_name, domain, contact_email, registry_url, email_verified,
       domain_verified, ever_proven, status, moderation, identifier, media_type, publisher, extensions)
      VALUES (${id}, ${id}, ${domain}, ${email}, 'https://example.com/catalog',
        ${opts.proven ?? true}, ${domain !== null && (opts.proven ?? true)}, ${opts.proven ?? true},
        ${opts.status ?? 'active'}, ${opts.moderation ?? 'none'}, ${profile.identifier}, ${profile.mediaType},
        ${sql.json(JSON.parse(JSON.stringify(profile.publisher)))},
        ${sql.json(JSON.parse(JSON.stringify(profile.extensions)))})`;
    return (await findByOrgId(id))!;
  }
  function claim(id: string, jwt = ownerToken, code?: string, instance = app, ip = '127.0.0.1') {
    return instance.inject({ method: 'POST', url: `/api/v1/orgs/${id}/claim`,
      headers: { authorization: `Bearer ${jwt}` }, remoteAddress: ip,
      ...(code ? { payload: { token: code } } : {}),
    });
  }
  async function issue(id: string, jwt = ownerToken) {
    const response = await claim(id, jwt);
    expect(response.statusCode, response.body).toBe(202);
    return response.json();
  }
  async function publish(id: string, jwt = ownerToken) {
    const body = await issue(id, jwt);
    records.set(body.record_name, [...(records.get(body.record_name) ?? []), body.record_value]);
    return body;
  }
  async function admins(id: string) {
    return getSql()`SELECT user_id FROM org_memberships WHERE org_id = ${id} AND role = 'admin'`;
  }
  async function challenges(id: string) {
    return getSql()`SELECT c.* FROM org_recovery_challenges c JOIN organizations o
      ON o.id = c.organization_id WHERE o.org_id = ${id}`;
  }
  async function emailCode(id: string, jwt = ownerToken) {
    const body = await issue(id, jwt);
    expect(body.method).toBe('email');
    const code = sendRecoveryMock.mock.calls.at(-1)![1] as string;
    expect(body).not.toHaveProperty('token');
    expect(JSON.stringify(body)).not.toContain(code);
    return code;
  }

  it.each(NANDA_MEDIA_TYPES)('recovers domain-backed %s and preserves its discovery profile', async (mediaType) => {
    const id = 'recovery-domain';
    const before = await seed(id, { mediaType });
    const update = () => app.inject({ method: 'PUT', url: `/api/v1/orgs/${id}`,
      headers: { authorization: `Bearer ${ownerToken}` }, payload: { tags: ['recovered'] } });
    expect((await update()).statusCode).toBe(403);
    await publish(id);
    expect((await claim(id)).statusCode).toBe(201);
    expect(await findByOrgId(id)).toEqual(before);
    expect((await update()).statusCode).toBe(200);
    expect(await admins(id)).toEqual([{ userId: ownerId }]);
  });

  it.each(SINGLE_RESOURCE_MEDIA_TYPES)('recovers personal %s through its registered email', async (mediaType) => {
    const id = 'recovery-personal';
    // Account email may differ from the entry's owner address. Both the fresh
    // mailbox proof and the initiating account session are required.
    const before = await seed(id, { personal: true, mediaType, email: 'JohnDoe@gmail.com' });
    const code = await emailCode(id);
    expect(sendRecoveryMock).toHaveBeenCalledWith('johndoe@gmail.com', code, id, 'recovery-owner@example.com');
    expect((await claim(id, ownerToken, code)).statusCode).toBe(201);
    expect(await findByOrgId(id)).toEqual(before);
    expect(await admins(id)).toEqual([{ userId: ownerId }]);
    expect(resolveTxtMock).not.toHaveBeenCalled();
    const update = await app.inject({ method: 'PUT', url: `/api/v1/orgs/${id}`,
      headers: { authorization: `Bearer ${ownerToken}` }, payload: { tags: ['recovered'] } });
    expect(update.statusCode).toBe(200);
  });

  it('the orphaned state is reachable by deleting the owning account', async () => {
    const id = 'recovery-cascade'; await seed(id);
    const sql = getSql();
    await sql`INSERT INTO org_memberships (user_id, org_id, role) VALUES (${otherId}, ${id}, 'admin')`;
    await sql`DELETE FROM users WHERE id = ${otherId}`;
    expect(await admins(id)).toHaveLength(0);
    expect((await findByOrgId(id))!.status).toBe('active');
  });

  it('keeps admin membership private until a caller proves ownership', async () => {
    const sql = getSql();
    await seed('recovery-admin'); await seed('recovery-orphan');
    await sql`INSERT INTO org_memberships (user_id, org_id, role) VALUES (${otherId}, 'recovery-admin', 'admin')`;
    const administered = await publish('recovery-admin');
    const orphan = await issue('recovery-orphan');
    expect(Object.keys(administered).sort()).toEqual(Object.keys(orphan).sort());
    const result = await claim('recovery-admin');
    expect(result.statusCode).toBe(409);
    expect(result.json().error).toBe('ALREADY_ADMINISTERED');
    expect(await admins('recovery-admin')).toEqual([{ userId: otherId }]);
  });

  it('does not let another account use the owner’s published DNS proof', async () => {
    const id = 'recovery-wrong-caller'; await seed(id);
    const owner = await publish(id);
    const other = await issue(id, otherToken);
    expect(other.record_value).not.toBe(owner.record_value);
    expect((await claim(id, otherToken)).statusCode).toBe(400);
    expect(await admins(id)).toHaveLength(0);
    expect((await claim(id)).statusCode).toBe(201);
  });

  it('does not disturb registration’s existing domain challenge', async () => {
    const id = 'recovery-separate'; await seed(id);
    const sql = getSql();
    await sql`UPDATE organizations SET domain_challenge = 'registration-token',
      domain_challenge_expires_at = NOW() + INTERVAL '1 day' WHERE org_id = ${id}`;
    const body = await publish(id);
    expect(body.record_name).toBe(`_nanda-recovery.${id}.example.com`);
    expect(body.record_value).toMatch(/^nanda-recover=[a-f0-9]{64}$/);
    expect((await claim(id)).statusCode).toBe(201);
    expect((await findByOrgId(id))!.domainChallenge).toBe('registration-token');
  });

  it.each([{ values: [] }, { values: ['nanda-recover=wrong'] }])('requires the correct TXT value: $values', async ({ values }) => {
    const id = 'recovery-no-proof'; await seed(id);
    const issued = await issue(id);
    records.set(issued.record_name, values);
    expect((await claim(id)).statusCode).toBe(400);
    expect(await admins(id)).toHaveLength(0);
  });

  it('promotes an existing member when no administrator exists', async () => {
    const id = 'recovery-promote'; await seed(id);
    await getSql()`INSERT INTO org_memberships (user_id, org_id, role) VALUES (${ownerId}, ${id}, 'member')`;
    await publish(id);
    expect((await claim(id)).statusCode).toBe(201);
    expect(await admins(id)).toEqual([{ userId: ownerId }]);
  });

  it('grants exactly one admin when two independently valid DNS proofs race', async () => {
    const id = 'recovery-race'; await seed(id);
    await publish(id); await publish(id, otherToken);
    const original = dns.lookupTxtToken;
    let arrive = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const timeout = setTimeout(release, 2000);
    vi.spyOn(dns, 'lookupTxtToken').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (++arrive === 2) release();
      await barrier;
      return result;
    });
    try {
      const results = await Promise.all([claim(id), claim(id, otherToken)]);
      expect(results.map(r => r.statusCode).sort()).toEqual([201, 409]);
      expect(await admins(id)).toHaveLength(1);
      expect(await challenges(id)).toHaveLength(0);
    } finally { clearTimeout(timeout); }
  });

  it('consumes all competing proofs and refuses replay after the recovered account is deleted', async () => {
    const id = 'recovery-replay'; await seed(id);
    await publish(id); const old = await publish(id, otherToken);
    expect((await claim(id)).statusCode).toBe(201);
    expect(await challenges(id)).toHaveLength(0);
    await getSql()`DELETE FROM users WHERE id = ${ownerId}`;
    const fresh = await issue(id, otherToken);
    expect(fresh.record_value).not.toBe(old.record_value);
    expect((await claim(id, otherToken)).statusCode).toBe(400);
    expect(await admins(id)).toHaveLength(0);
  });

  it('rotates an expired DNS proof and refuses the still-published old record', async () => {
    const id = 'recovery-expired'; await seed(id); const old = await publish(id);
    await getSql()`UPDATE org_recovery_challenges SET expires_at = NOW() - INTERVAL '1 second'`;
    const fresh = await issue(id);
    expect(fresh.record_value).not.toBe(old.record_value);
    expect((await claim(id)).statusCode).toBe(400);
    expect(await admins(id)).toHaveLength(0);
  });

  it.each(['expiry', 'domain', 'domain-away-and-back', 'takedown', 'session-revocation', 'admin-added'])
    ('rechecks %s after DNS verification and before granting access', async (change) => {
      const id = 'recovery-during-dns'; const org = await seed(id); await publish(id);
      const original = dns.lookupTxtToken;
      vi.spyOn(dns, 'lookupTxtToken').mockImplementation(async (...args) => {
        const result = await original(...args);
        const sql = getSql();
        if (change === 'expiry') await sql`UPDATE org_recovery_challenges SET expires_at = clock_timestamp() - INTERVAL '1 second'`;
        if (change === 'domain' || change === 'domain-away-and-back') {
          await sql`UPDATE organizations SET domain = 'new-owner.example.com',
            identifier = 'urn:air:new-owner.example.com:catalog:root' WHERE org_id = ${id}`;
          if (change === 'domain-away-and-back') await sql`UPDATE organizations SET
            domain = ${org.domain}, identifier = ${org.identifier} WHERE org_id = ${id}`;
        }
        if (change === 'takedown') await sql`UPDATE organizations SET moderation = 'takedown' WHERE org_id = ${id}`;
        if (change === 'session-revocation') await sql`UPDATE users SET token_version = token_version + 1 WHERE id = ${ownerId}`;
        if (change === 'admin-added') await sql`INSERT INTO org_memberships (user_id, org_id, role) VALUES (${otherId}, ${id}, 'admin')`;
        return result;
      });
      const result = await claim(id);
      expect(result.statusCode).toBe(change === 'session-revocation' ? 401 : 409);
      expect((await admins(id)).some(r => r.userId === ownerId)).toBe(false);
    });

  it('does not reuse a proof when the organization slug is deleted and registered again', async () => {
    const id = 'recovery-recreated'; await seed(id); const old = await publish(id);
    await getSql()`DELETE FROM organizations WHERE org_id = ${id}`;
    await seed(id);
    const fresh = await issue(id);
    expect(fresh.record_value).not.toBe(old.record_value);
    expect((await claim(id)).statusCode).toBe(400);
    expect(await admins(id)).toHaveLength(0);
  });

  it('stores only an email code hash, does not resend on polling, and refuses another account', async () => {
    const id = 'recovery-email-binding'; await seed(id, { personal: true });
    const code = await emailCode(id);
    expect(code).toMatch(/^[a-f0-9]{64}$/);
    const [stored] = await challenges(id);
    expect(stored!.tokenHash).toBe(createHash('sha256').update(code).digest('hex'));
    expect(stored!.dnsToken).toBeNull();
    expect(JSON.stringify(stored)).not.toContain(code);
    expect((await claim(id)).statusCode).toBe(202);
    expect(sendRecoveryMock).toHaveBeenCalledTimes(1);
    expect((await claim(id, otherToken, code)).statusCode).toBe(400);
    expect((await claim(id, ownerToken, '0'.repeat(64))).statusCode).toBe(400);
    expect(await admins(id)).toHaveLength(0);
    expect((await claim(id, ownerToken, code)).statusCode).toBe(201);
    expect(await challenges(id)).toHaveLength(0);
    expect((await claim(id, ownerToken, code)).statusCode).toBe(400);
  });

  it('does not let a second account use an email code issued to the first', async () => {
    const id = 'recovery-email-two'; await seed(id, { personal: true });
    const first = await emailCode(id);
    const second = await emailCode(id, otherToken);
    expect(second).not.toBe(first);
    expect((await claim(id, otherToken, first)).statusCode).toBe(400);
    expect((await claim(id, ownerToken, second)).statusCode).toBe(400);
    expect((await claim(id, ownerToken, first)).statusCode).toBe(201);
    expect(await challenges(id)).toHaveLength(0);
  });

  async function extraAccount(name: string) {
    const user = await upsertUser({ email: `recovery-${name}@example.com`, displayName: null,
      avatarUrl: null, provider: 'github', providerId: `recovery-${name}`, emailVerified: true });
    return app.jwt.sign({ userId: user.id, email: user.email, displayName: null, tokenVersion: user.tokenVersion });
  }

  it('caps live recovery emails per address across accounts without invalidating earlier codes', async () => {
    const id = 'recovery-mail-cap'; await seed(id, { personal: true });
    const code = await emailCode(id);
    await emailCode(id, otherToken);
    await emailCode(id, await extraAccount('third'));
    const capped = await claim(id, await extraAccount('fourth'));
    expect(capped.statusCode).toBe(429);
    expect(capped.json().error).toBe('RECOVERY_COOLDOWN');
    expect(sendRecoveryMock).toHaveBeenCalledTimes(3);
    expect((await claim(id, ownerToken, code)).statusCode).toBe(201);
  });

  it('does not let one account block the owner from requesting a code', async () => {
    const id = 'recovery-mail-no-block'; await seed(id, { personal: true });
    await emailCode(id, otherToken);
    const code = await emailCode(id);
    expect((await claim(id, ownerToken, code)).statusCode).toBe(201);
  });

  it('mails no one for an administered personal entry and answers exactly as for an orphan', async () => {
    const sql = getSql();
    await seed('recovery-mail-admin', { personal: true }); await seed('recovery-mail-orphan', { personal: true });
    await sql`INSERT INTO org_memberships (user_id, org_id, role) VALUES (${otherId}, 'recovery-mail-admin', 'admin')`;
    const administered = await claim('recovery-mail-admin');
    const orphan = await claim('recovery-mail-orphan');
    expect(administered.statusCode).toBe(202);
    expect(Object.keys(administered.json()).sort()).toEqual(Object.keys(orphan.json()).sort());
    expect(administered.json().status).toBe(orphan.json().status);
    expect(sendRecoveryMock).toHaveBeenCalledTimes(1);
    expect(sendRecoveryMock.mock.calls[0]![0]).toBe('recovery-mail-orphan@example.com');

    const wrong = '0'.repeat(64);
    const adminGuess = await claim('recovery-mail-admin', ownerToken, wrong);
    const orphanGuess = await claim('recovery-mail-orphan', ownerToken, wrong);
    expect(adminGuess.statusCode).toBe(400);
    expect(adminGuess.json()).toEqual(orphanGuess.json());
    expect(await admins('recovery-mail-admin')).toEqual([{ userId: otherId }]);
  });

  it('gives a wrong code and a code with no live proof the same answer', async () => {
    const id = 'recovery-mail-oracle'; await seed(id, { personal: true });
    const noProof = await claim(id, ownerToken, '1'.repeat(64));
    await emailCode(id);
    const wrongCode = await claim(id, ownerToken, '1'.repeat(64));
    expect(noProof.statusCode).toBe(400);
    expect(noProof.json()).toEqual(wrongCode.json());
  });

  it('allows a fresh email attempt after delivery fails', async () => {
    const id = 'recovery-mail-failed'; await seed(id, { personal: true });
    sendRecoveryMock.mockRejectedValueOnce(new Error('mail unavailable'));
    expect((await claim(id)).statusCode).toBe(500);
    expect(await challenges(id)).toHaveLength(0);
    const code = await emailCode(id);
    expect((await claim(id, ownerToken, code)).statusCode).toBe(201);
  });

  it('rejects an expired email code without sending another email', async () => {
    const id = 'recovery-email-expiry'; await seed(id, { personal: true });
    const code = await emailCode(id);
    await getSql()`UPDATE org_recovery_challenges SET expires_at = NOW() - INTERVAL '1 second'`;
    expect((await claim(id, ownerToken, code)).statusCode).toBe(400);
    expect(sendRecoveryMock).toHaveBeenCalledTimes(1);
    expect(await admins(id)).toHaveLength(0);
  });

  it.each(['contact', 'subjectAccount', 'identifier'])('refuses inconsistent personal %s identity', async (field) => {
    const id = 'recovery-email-inconsistent'; await seed(id, { personal: true });
    const sql = getSql();
    if (field === 'contact') await sql`UPDATE organizations SET contact_email = 'other@example.com' WHERE org_id = ${id}`;
    if (field === 'identifier') await sql`UPDATE organizations SET identifier = 'urn:air:host39.org:personal:other@example.com' WHERE org_id = ${id}`;
    if (field === 'subjectAccount') await sql`UPDATE organizations SET extensions =
      ${sql.json({ [NANDA_EXTENSION]: { subjectAccount: 'other@example.com' } })} WHERE org_id = ${id}`;
    expect((await claim(id)).statusCode).toBe(409);
    expect(sendRecoveryMock).not.toHaveBeenCalled();
    expect(await admins(id)).toHaveLength(0);
  });

  it.each([false, true])('refuses unproven, pending, and taken-down entries (personal=%s)', async (personal) => {
    for (const [suffix, opts] of Object.entries({
      unproven: { proven: false }, pending: { status: 'pending' }, takedown: { moderation: 'takedown' },
    })) {
      const id = `recovery-policy-${suffix}`;
      await seed(id, { ...opts, personal });
      expect((await claim(id)).statusCode).toBe(409);
      expect(await challenges(id)).toHaveLength(0);
      expect(await admins(id)).toHaveLength(0);
    }
    expect(sendRecoveryMock).not.toHaveBeenCalled();
    expect(resolveTxtMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves suspension and hidden moderation (personal=%s)', async (personal) => {
    const id = 'recovery-hidden';
    const before = await seed(id, { personal, status: 'suspended', moderation: 'hidden' });
    const code = personal ? await emailCode(id) : (await publish(id), undefined);
    expect((await claim(id, ownerToken, code)).statusCode).toBe(201);
    expect(await findByOrgId(id)).toEqual(before);
  });

  it('counts an account’s requests across different source IPs', async () => {
    vi.stubEnv('ORG_RECOVERY_RATE_LIMIT_MAX', '2');
    const limited = (await buildServer({ logger: false })).fastify;
    await limited.ready();
    try {
      expect((await claim('recovery-missing', ownerToken, undefined, limited, '192.0.2.1')).statusCode).toBe(404);
      expect((await claim('recovery-missing', ownerToken, undefined, limited, '192.0.2.2')).statusCode).toBe(404);
      const refused = await claim('recovery-missing', ownerToken, undefined, limited, '192.0.2.3');
      expect(refused.statusCode).toBe(429);
      expect(refused.json().error).toBe('RECOVERY_RATE_LIMIT');
      expect((await claim('recovery-missing', otherToken, undefined, limited, '192.0.2.3')).statusCode).toBe(404);
    } finally { await limited.close(); vi.unstubAllEnvs(); }
  });

  it('rejects unauthenticated and unverified accounts', async () => {
    await seed('recovery-auth');
    const anonymous = await app.inject({ method: 'POST', url: '/api/v1/orgs/recovery-auth/claim' });
    expect(anonymous.statusCode).toBe(401);
    await getSql()`UPDATE users SET email_verified = false WHERE id = ${ownerId}`;
    expect((await claim('recovery-auth')).statusCode).toBe(403);
    expect(await challenges('recovery-auth')).toHaveLength(0);
  });

  it('reports an unknown organization explicitly', async () => {
    const result = await claim('recovery-missing');
    expect(result.statusCode).toBe(404);
    expect(result.json()).toEqual({ error: 'NOT_FOUND', detail: 'org "recovery-missing" not found' });
  });
});
