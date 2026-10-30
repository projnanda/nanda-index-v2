import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// DNS answers come from this spy, so a test decides who can prove a domain.
const { resolveTxtMock } = vi.hoisted(() => ({ resolveTxtMock: vi.fn() }));
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
import { captureOrgVerificationEmails } from '../helpers/orgVerificationEmails.js';

/**
 * Claims, proof and publication.
 *
 * An unproven registration must not be able to publish (reactivate bypass) or
 * to reserve an identity someone else can prove (squatting). Whoever proves
 * ownership first wins, and the unproven claims on that identity disappear.
 */

const PREFIX = 'cl-';

// The production cap, read per request — setup.ts raises it for other suites.
process.env['MAX_UNPROVEN_ORGS_PER_USER'] = '5';

type Payload = Record<string, unknown>;

function domainOrg(orgId: string, domain: string): Payload {
  return {
    org_id: orgId, display_name: 'Claim Test', hosting_path: 'registry', domain,
    contact_email: `admin@${domain}`, registry_url: `https://${domain}/r`,
  };
}

function personalOrg(orgId: string, email: string): Payload {
  return {
    org_id: orgId, display_name: 'Personal Claim', hosting_path: 'personal',
    contact_email: email, registry_url: 'https://agentcards.host39.org/personal/card.json',
  };
}

describe('Org claims — proof before publication, no squatting', () => {
  let fastify: FastifyInstance;
  let emails: ReturnType<typeof captureOrgVerificationEmails>;
  const tokens: Record<string, string> = {};

  const create = (who: string, payload: Payload) => fastify.inject({
    method: 'POST', url: '/api/v1/orgs',
    headers: { authorization: `Bearer ${tokens[who]}` }, payload,
  });
  const post = (who: string, url: string) => fastify.inject({
    method: 'POST', url, headers: { authorization: `Bearer ${tokens[who]}` },
  });
  const suspend = (who: string, orgId: string) => fastify.inject({
    method: 'DELETE', url: `/api/v1/orgs/${orgId}/suspend`,
    headers: { authorization: `Bearer ${tokens[who]}` },
  });
  const status = async (orgId: string): Promise<string | undefined> => {
    const rows = await getSql()<{ status: string }[]>`SELECT status FROM organizations WHERE org_id = ${orgId}`;
    return rows[0]?.status;
  };
  const verifyEmail = async (orgId: string) => {
    return fastify.inject({ method: 'POST', url: '/api/v1/verify-email', payload: { token: emails.tokenFor(orgId) } });
  };
  const proveDomain = async (who: string, orgId: string) => {
    const chal = (await post(who, `/api/v1/orgs/${orgId}/domain-challenge`)).json();
    resolveTxtMock.mockResolvedValue([[chal.record_value]]);
    return post(who, `/api/v1/orgs/${orgId}/verify-domain`);
  };

  beforeAll(async () => {
    emails = captureOrgVerificationEmails();
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();
    for (const who of ['alice', 'bob', 'carol']) {
      const user = await upsertUser({
        email: `${PREFIX}${who}@example.com`, displayName: who, avatarUrl: null,
        provider: 'google', providerId: `${PREFIX}${who}`,
      });
      tokens[who] = fastify.jwt.sign({ userId: user.id, email: user.email, displayName: null });
    }
  });

  afterAll(async () => {
    emails.restore();
    await fastify.close();
    const { closeSql } = await import('../../src/db/client.js');
    await closeSql();
  });

  beforeEach(async () => {
    resolveTxtMock.mockReset();
    resolveTxtMock.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }));
    const sql = getSql();
    await sql`DELETE FROM org_memberships WHERE org_id LIKE ${`${PREFIX}%`}`;
    await sql`DELETE FROM organizations WHERE org_id LIKE ${`${PREFIX}%`}`;
  });

  // ── #1 publication requires proof ────────────────────────────────────────────

  describe('reactivate', () => {
    it('refuses to reactivate an org that was never suspended', async () => {
      await create('alice', personalOrg(`${PREFIX}p1`, 'cl-victim1@example.org'));

      const res = await post('alice', `/api/v1/orgs/${PREFIX}p1/reactivate`);

      expect(res.statusCode).toBe(409);
      expect(await status(`${PREFIX}p1`)).toBe('pending');
    });

    it('returns an unverified personal org to pending, not active, after suspend', async () => {
      await create('alice', personalOrg(`${PREFIX}p2`, 'cl-victim2@example.org'));
      await suspend('alice', `${PREFIX}p2`);

      const res = await post('alice', `/api/v1/orgs/${PREFIX}p2/reactivate`);

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('pending');
      const resolved = await fastify.inject({
        method: 'GET', url: `/api/v1/resolve?locator=${encodeURIComponent('urn:air:host39.org:personal:cl-victim2@example.org')}`,
      });
      expect(resolved.statusCode).toBe(404);
    });

    it('reactivates a verified personal org to active', async () => {
      await create('alice', personalOrg(`${PREFIX}p3`, 'cl-owner3@example.org'));
      await verifyEmail(`${PREFIX}p3`);
      await suspend('alice', `${PREFIX}p3`);

      const res = await post('alice', `/api/v1/orgs/${PREFIX}p3/reactivate`);

      expect(res.json().status).toBe('active');
    });
  });

  // ── #2 unproven claims reserve nothing; first proof wins ─────────────────────

  describe('domain claims', () => {
    it('lets a second registrant claim a domain someone registered but never proved', async () => {
      expect((await create('alice', domainOrg(`${PREFIX}squat`, 'cl-mit.example.edu'))).statusCode).toBe(201);

      const real = await create('bob', domainOrg(`${PREFIX}real`, 'cl-mit.example.edu'));

      expect(real.statusCode).toBe(201);
    });

    it('removes the unproven claims when the real owner proves the domain', async () => {
      await create('alice', domainOrg(`${PREFIX}squat`, 'cl-mit.example.edu'));
      await create('bob', domainOrg(`${PREFIX}real`, 'cl-mit.example.edu'));

      const proved = await proveDomain('bob', `${PREFIX}real`);

      expect(proved.statusCode).toBe(200);
      expect(proved.json().status).toBe('active');
      expect(await status(`${PREFIX}squat`)).toBeUndefined();
    });

    it('blocks new registrations once a domain is proven', async () => {
      await create('bob', domainOrg(`${PREFIX}real`, 'cl-mit.example.edu'));
      await proveDomain('bob', `${PREFIX}real`);

      const late = await create('carol', domainOrg(`${PREFIX}late`, 'cl-mit.example.edu'));

      expect(late.statusCode).toBe(409);
    });

    it('resolves the proven entry when an unproven claim on the same domain is newer', async () => {
      await create('bob', domainOrg(`${PREFIX}real`, 'cl-res.example.edu'));
      await proveDomain('bob', `${PREFIX}real`);
      // A leftover unproven row on the same domain (e.g. written before the proof settled).
      await getSql()`
        INSERT INTO organizations (org_id, display_name, domain, contact_email, registry_url, identifier, status, publisher)
        SELECT ${`${PREFIX}ghost`}, 'Ghost', domain, contact_email, 'https://evil.example/r', identifier, 'pending', publisher
        FROM organizations WHERE org_id = ${`${PREFIX}real`}`;

      const res = await fastify.inject({
        method: 'GET', url: `/api/v1/resolve?locator=${encodeURIComponent('urn:air:cl-res.example.edu:catalog:root')}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain('evil.example');
    });
  });

  describe('personal email claims', () => {
    it('does not let an unverified claim on an email block its owner', async () => {
      await create('alice', personalOrg(`${PREFIX}fake`, 'cl-someone@example.org'));

      const owner = await create('bob', personalOrg(`${PREFIX}mine`, 'cl-someone@example.org'));
      expect(owner.statusCode).toBe(201);

      await verifyEmail(`${PREFIX}mine`);
      expect(await status(`${PREFIX}mine`)).toBe('active');
      expect(await status(`${PREFIX}fake`)).toBeUndefined();
    });
  });

  describe('org_id slugs', () => {
    it('keeps a fresh unverified slug reserved', async () => {
      await create('alice', domainOrg(`${PREFIX}slug`, 'cl-a.example.edu'));

      const res = await create('bob', domainOrg(`${PREFIX}slug`, 'cl-b.example.edu'));

      expect(res.statusCode).toBe(409);
    });

    it('releases a slug held by an unverified org for more than 48 hours, even if suspended', async () => {
      await create('alice', domainOrg(`${PREFIX}slug`, 'cl-a.example.edu'));
      await suspend('alice', `${PREFIX}slug`);
      await getSql()`UPDATE organizations SET created_at = NOW() - INTERVAL '49 hours' WHERE org_id = ${`${PREFIX}slug`}`;

      const res = await create('bob', domainOrg(`${PREFIX}slug`, 'cl-b.example.edu'));

      expect(res.statusCode).toBe(201);
    });
  });

  describe('slug release never destroys a real org', () => {
    it('keeps the slug of an old org that was proven and then lost its proof', async () => {
      await create('alice', domainOrg(`${PREFIX}real-old`, 'cl-old.example.edu'));
      await proveDomain('alice', `${PREFIX}real-old`);
      // Domain changed through the API (proof lost), long after creation.
      const moved = await fastify.inject({
        method: 'PUT', url: `/api/v1/orgs/${PREFIX}real-old`,
        headers: { authorization: `Bearer ${tokens['alice']}` },
        payload: { domain: 'cl-moved.example.edu' },
      });
      expect(moved.json().domain_verified).toBe(false);
      await getSql()`UPDATE organizations SET created_at = NOW() - INTERVAL '30 days' WHERE org_id = ${`${PREFIX}real-old`}`;

      const res = await create('bob', domainOrg(`${PREFIX}real-old`, 'cl-other.example.edu'));

      expect(res.statusCode).toBe(409);
      expect(await status(`${PREFIX}real-old`)).toBe('pending');
    });

    it('does not release an expired slug when the request fails for another reason', async () => {
      await create('bob', domainOrg(`${PREFIX}owner`, 'cl-taken.example.edu'));
      await proveDomain('bob', `${PREFIX}owner`);
      await create('alice', domainOrg(`${PREFIX}old-claim`, 'cl-old-claim.example.edu'));
      await getSql()`UPDATE organizations SET created_at = NOW() - INTERVAL '49 hours' WHERE org_id = ${`${PREFIX}old-claim`}`;

      // Reuses the expired slug but targets a domain someone has proven: refused.
      const res = await create('carol', domainOrg(`${PREFIX}old-claim`, 'cl-taken.example.edu'));

      expect(res.statusCode).toBe(409);
      expect(await status(`${PREFIX}old-claim`)).toBe('pending');
    });
  });

  describe('concurrent proofs', () => {
    it('lets exactly one of two simultaneous proofs win, cleanly', async () => {
      await create('alice', domainOrg(`${PREFIX}race-a`, 'cl-race.example.edu'));
      await create('bob', domainOrg(`${PREFIX}race-b`, 'cl-race.example.edu'));
      const chalA = (await post('alice', `/api/v1/orgs/${PREFIX}race-a/domain-challenge`)).json();
      const chalB = (await post('bob', `/api/v1/orgs/${PREFIX}race-b/domain-challenge`)).json();
      resolveTxtMock.mockResolvedValue([[chalA.record_value], [chalB.record_value]]);

      const [a, b] = await Promise.all([
        post('alice', `/api/v1/orgs/${PREFIX}race-a/verify-domain`),
        post('bob', `/api/v1/orgs/${PREFIX}race-b/verify-domain`),
      ]);

      const codes = [a.statusCode, b.statusCode].sort();
      expect(codes[0]).toBe(200);
      // The loser either lost the race (409) or its claim — and with it the
      // caller's membership — was already removed by the winner (403/404).
      // Never a 500.
      expect([403, 404, 409]).toContain(codes[1]);
      const live = await getSql()`SELECT org_id FROM organizations WHERE domain = 'cl-race.example.edu' AND domain_verified`;
      expect(live).toHaveLength(1);
    });
  });

  describe('open claims per account', () => {
    it('does not count expired unverified claims against the cap', async () => {
      for (let i = 0; i < 5; i++) {
        await create('carol', domainOrg(`${PREFIX}exp${i}`, `cl-exp${i}.example.edu`));
      }
      await getSql()`UPDATE organizations SET created_at = NOW() - INTERVAL '49 hours' WHERE org_id LIKE ${`${PREFIX}exp%`}`;

      const res = await create('carol', domainOrg(`${PREFIX}fresh`, 'cl-fresh.example.edu'));

      expect(res.statusCode).toBe(201);
    });

    it('caps how many unverified orgs one account can hold', async () => {
      for (let i = 0; i < 5; i++) {
        expect((await create('carol', domainOrg(`${PREFIX}cap${i}`, `cl-cap${i}.example.edu`))).statusCode).toBe(201);
      }

      const sixth = await create('carol', domainOrg(`${PREFIX}cap5`, 'cl-cap5.example.edu'));

      expect(sixth.statusCode).toBe(429);
      expect(sixth.json().error).toBe('TOO_MANY_UNVERIFIED');
    });
  });

  // ── #5 public read of a single entry ─────────────────────────────────────────

  describe('GET /api/v1/index/:org_id', () => {
    it('hides a pending entry and its subject email', async () => {
      await create('alice', personalOrg(`${PREFIX}hidden`, 'cl-private@example.org'));

      const res = await fastify.inject({ method: 'GET', url: `/api/v1/index/${PREFIX}hidden` });

      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('cl-private@example.org');
    });

    it('hides a suspended entry', async () => {
      await create('alice', personalOrg(`${PREFIX}susp`, 'cl-susp@example.org'));
      await verifyEmail(`${PREFIX}susp`);
      await suspend('alice', `${PREFIX}susp`);

      const res = await fastify.inject({ method: 'GET', url: `/api/v1/index/${PREFIX}susp` });

      expect(res.statusCode).toBe(404);
    });

    it('shows a live entry', async () => {
      await create('alice', personalOrg(`${PREFIX}live`, 'cl-live@example.org'));
      await verifyEmail(`${PREFIX}live`);

      const res = await fastify.inject({ method: 'GET', url: `/api/v1/index/${PREFIX}live` });

      expect(res.statusCode).toBe(200);
    });
  });
});
