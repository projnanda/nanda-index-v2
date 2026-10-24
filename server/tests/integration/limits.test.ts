import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';
import { upsertUser } from '../../src/db/queries/users.js';

const OPERATOR_EMAIL = 'lim-operator@example.com';

const TRUST_MANIFEST = {
  identity: 'did:web:lim-trust.example.com',
  attestations: [{ type: 'SOC2', uri: 'https://lim-trust.example.com/soc2.pdf', mediaType: 'application/pdf' }],
};

/** A nested object `depth` levels deep: depth 1 is `{ v: 1 }`. */
function nested(depth: number): Record<string, unknown> {
  return depth <= 1 ? { v: 1 } : { child: nested(depth - 1) };
}

async function seedOrg(orgId: string, opts: { mediaType?: string; tags?: string[]; trust?: boolean } = {}): Promise<void> {
  const sql = getSql();
  const domain = `${orgId}.example.com`;
  await sql`
    INSERT INTO organizations
      (org_id, display_name, domain, contact_email, registry_url, verify_token,
       email_verified, domain_verified, status, identifier, media_type, description, tags, trust_manifest)
    VALUES
      (${orgId}, ${`Limits ${orgId}`}, ${domain}, ${`admin@${domain}`},
       ${`https://${domain}/card`}, ${randomBytes(16).toString('hex')},
       true, true, 'active', ${`urn:air:${domain}:agent:main`},
       ${opts.mediaType ?? 'application/a2a-agent-card+json'},
       'quokkalimits pastry delivery', ${sql.array(opts.tags ?? ['quokkalimits'])},
       ${opts.trust ? sql.json(TRUST_MANIFEST) : null})
  `;
}

function personalOrg(orgId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    org_id: orgId,
    display_name: 'Limits Test',
    hosting_path: 'personal',
    contact_email: `${orgId}@example.com`,
    registry_url: `https://host39.org/cards/${orgId}`,
    ...extra,
  };
}

describe('Public limits, reserved ids and unverified trust data', () => {
  let fastify: FastifyInstance;
  let userToken: string;
  let operatorToken: string;

  beforeAll(async () => {
    process.env['ADMIN_EMAILS'] = OPERATOR_EMAIL;
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();

    const user = await upsertUser({
      email: 'lim-user@example.com', displayName: null, avatarUrl: null, provider: 'google', providerId: 'lim-user-pid',
    });
    userToken = fastify.jwt.sign({ userId: user.id, email: user.email, displayName: null });
    const operator = await upsertUser({
      email: OPERATOR_EMAIL, displayName: null, avatarUrl: null, provider: 'google', providerId: 'lim-operator-pid',
    });
    operatorToken = fastify.jwt.sign({ userId: operator.id, email: operator.email, displayName: null });
  });

  afterAll(async () => {
    delete process.env['ADMIN_EMAILS'];
    await fastify.close();
    const { closeSql } = await import('../../src/db/client.js');
    await closeSql();
  });

  beforeEach(async () => {
    const sql = getSql();
    await sql`DELETE FROM organizations WHERE org_id LIKE 'lim-%' OR org_id IN ('openai', 'nanda')`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const create = (token: string, payload: Record<string, unknown>) =>
    fastify.inject({
      method: 'POST', url: '/api/v1/orgs', headers: { authorization: `Bearer ${token}` }, payload,
    });

  // ── M7: pagination on GET /api/v1/index ───────────────────────────────────

  describe('GET /api/v1/index pagination', () => {
    it('honours limit and reports the total in X-Total-Count', async () => {
      await seedOrg('lim-a');
      await seedOrg('lim-b');
      await seedOrg('lim-c');

      const res = await fastify.inject({ method: 'GET', url: '/api/v1/index?limit=2' });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
      expect(res.json()).toHaveLength(2);
      expect(Number(res.headers['x-total-count'])).toBeGreaterThanOrEqual(3);
    });

    it('defaults to 100 entries and returns an empty page past the end', async () => {
      const first = await fastify.inject({ method: 'GET', url: '/api/v1/index' });
      expect(first.json().length).toBeLessThanOrEqual(100);

      const past = await fastify.inject({ method: 'GET', url: '/api/v1/index?offset=1000000' });
      expect(past.statusCode).toBe(200);
      expect(past.json()).toEqual([]);
    });

    it('keeps creation order so offsets page deterministically', async () => {
      await seedOrg('lim-a');
      await seedOrg('lim-b');
      const res = await fastify.inject({ method: 'GET', url: '/api/v1/index?limit=500' });
      const ids = (res.json() as Array<{ extensions: Record<string, { orgId: string }> }>)
        .map((e) => e.extensions['org.projectnanda']!.orgId)
        .filter((id) => id.startsWith('lim-'));
      expect(ids).toEqual(['lim-a', 'lim-b']);
    });

    it('serves a page from the middle of the index in creation order', async () => {
      await seedOrg('lim-a');
      await seedOrg('lim-b');
      await seedOrg('lim-c');
      const orgIdsOf = (body: unknown) => (body as Array<{ extensions: Record<string, { orgId: string }> }>)
        .map((e) => e.extensions['org.projectnanda']!.orgId);

      const listAll = async () =>
        orgIdsOf((await fastify.inject({ method: 'GET', url: '/api/v1/index?limit=500' })).json());

      // Other suites add and remove entries in parallel, which shifts every
      // offset; compare only against a listing that held still around the page.
      for (let attempt = 0; attempt < 5; attempt++) {
        const before = await listAll();
        const offset = before.indexOf('lim-b');
        expect(offset).toBeGreaterThanOrEqual(0);
        const page = await fastify.inject({ method: 'GET', url: `/api/v1/index?limit=2&offset=${offset}` });
        const after = await listAll();
        if (after.join() !== before.join()) continue;

        expect(orgIdsOf(page.json())).toEqual(['lim-b', 'lim-c']);
        return;
      }
      throw new Error('the index kept changing under the test; no stable listing to compare against');
    });

    it.each(['limit=0', 'limit=501', 'offset=-1', 'limit=abc'])('rejects %s', async (qs) => {
      const res = await fastify.inject({ method: 'GET', url: `/api/v1/index?${qs}` });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── M7: client JSON caps ──────────────────────────────────────────────────

  describe('client JSON caps', () => {
    it('rejects extensions over 16 KB', async () => {
      const res = await create(userToken, personalOrg('lim-big', {
        extensions: { 'com.example': { blob: 'x'.repeat(17 * 1024) } },
      }));
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('PAYLOAD_TOO_LARGE');
    });

    it('rejects entry_data nested deeper than 6 levels', async () => {
      const res = await create(userToken, personalOrg('lim-deep', { entry_data: nested(7) }));
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('PAYLOAD_TOO_LARGE');
    });

    it('accepts entry_data exactly 6 levels deep', async () => {
      const res = await create(userToken, personalOrg('lim-ok', { entry_data: nested(6) }));
      expect(res.statusCode).toBe(201);
    });

    it('rejects an oversized trust_manifest', async () => {
      const res = await create(userToken, personalOrg('lim-tm', {
        trust_manifest: { identity: 'x', metadata: { blob: 'y'.repeat(17 * 1024) } },
      }));
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('PAYLOAD_TOO_LARGE');
    });

    it('applies the same caps on update', async () => {
      expect((await create(userToken, personalOrg('lim-upd'))).statusCode).toBe(201);
      const res = await fastify.inject({
        method: 'PUT', url: '/api/v1/orgs/lim-upd',
        headers: { authorization: `Bearer ${userToken}` },
        payload: { entry_data: nested(7) },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('PAYLOAD_TOO_LARGE');
    });

    it('rejects request bodies over 64 KB', async () => {
      const res = await create(userToken, personalOrg('lim-huge', { description: 'z'.repeat(70 * 1024) }));
      expect(res.statusCode).toBe(413);
    });
  });

  // ── M4: reserved org_id slugs ─────────────────────────────────────────────

  describe('reserved org_id slugs', () => {
    it('rejects a reserved org_id for a regular user', async () => {
      const res = await create(userToken, personalOrg('openai'));
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('RESERVED_ORG_ID');
    });

    it('lets an operator register a reserved org_id', async () => {
      const res = await create(operatorToken, personalOrg('nanda'));
      expect(res.statusCode).toBe(201);
    });
  });

  // ── M4: self-asserted trust manifest is marked unverified ─────────────────

  describe('trust manifest is marked unverified', () => {
    it('on the owner record', async () => {
      const res = await create(userToken, personalOrg('lim-trust', { trust_manifest: TRUST_MANIFEST }));
      expect(res.statusCode).toBe(201);
      expect(res.json().trust_manifest).toMatchObject(TRUST_MANIFEST);
      expect(res.json().trust_manifest_verified).toBe(false);
    });

    it('on public index entries', async () => {
      await seedOrg('lim-trust', { trust: true });
      const res = await fastify.inject({ method: 'GET', url: '/api/v1/index/lim-trust' });
      expect(res.json().trustManifest).toMatchObject(TRUST_MANIFEST);
      expect(res.json().trustManifestVerified).toBe(false);
    });

    it('is absent when there is no manifest', async () => {
      await seedOrg('lim-plain');
      const res = await fastify.inject({ method: 'GET', url: '/api/v1/index/lim-plain' });
      expect(res.json()).not.toHaveProperty('trustManifestVerified');
    });

    it('on agentic search candidates', async () => {
      await seedOrg('lim-trust', { trust: true });
      vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
      const res = await fastify.inject({ method: 'GET', url: '/api/v1/agentic-search?q=quokkalimits' });
      const ours = res.json().candidates.find((c: { provenance: { orgId: string } }) => c.provenance.orgId === 'lim-trust');
      expect(ours.trustManifest).toMatchObject(TRUST_MANIFEST);
      expect(ours.trustManifestVerified).toBe(false);
    });
  });
});
