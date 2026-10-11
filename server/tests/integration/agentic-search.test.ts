import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';
import { randomBytes } from 'node:crypto';

interface SeedOrgOptions {
  orgId: string;
  domain: string;
  displayName: string;
  description?: string;
  tags?: string[];
  mediaType?: string;
  registryUrl?: string;
}

async function seedOrg(opts: SeedOrgOptions): Promise<void> {
  const sql = getSql();
  const verifyToken = randomBytes(16).toString('hex');
  await sql`
    INSERT INTO organizations
      (org_id, display_name, domain, contact_email, registry_url, verify_token, email_verified, status,
       identifier, media_type, description, tags, publisher)
    VALUES
      (${opts.orgId}, ${opts.displayName}, ${opts.domain}, ${`admin@${opts.domain}`},
       ${opts.registryUrl ?? `https://${opts.domain}/registry`}, ${verifyToken}, true, 'active',
       ${`urn:air:${opts.domain}:catalog:root`},
       ${opts.mediaType ?? 'application/ai-catalog+json'},
       ${opts.description ?? null},
       ${sql.array(opts.tags ?? [])},
       ${sql.json({ identifier: opts.domain, displayName: opts.displayName, identityType: 'dns' })})
    ON CONFLICT (org_id) DO NOTHING
  `;
}

describe('GET /api/v1/agentic-search', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
    const { closeSql } = await import('../../src/db/client.js');
    await closeSql();
  });

  beforeEach(async () => {
    const sql = getSql();
    await sql`DELETE FROM organizations WHERE org_id LIKE 'ags-%'`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 400 when q is missing', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/agentic-search' });
    expect(res.statusCode).toBe(400);
  });

  it('returns empty candidates when nothing matches', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/agentic-search?q=zzznomatchxyz' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(0);
    expect(body.candidates).toEqual([]);
    expect(body.resolved).toBeNull();
  });

  it('ranks an enterprise org by tags/description and fans out to its registry for agent candidates', async () => {
    await seedOrg({
      orgId: 'ags-acme',
      domain: 'ags-acme.example.com',
      displayName: 'Acme Corp',
      description: 'Transactional email and SMS delivery for developers',
      tags: ['email', 'sms', 'notifications'],
      registryUrl: 'https://ags-acme-registry.example.com',
    });

    // The shared test DB may have other pre-existing active orgs (fixtures
    // seeded by other integration test files, never cleaned up) that also
    // happen to match this query — that's realistic multi-candidate
    // behavior, not a bug, so only branch on our own org's registry URL and
    // let any other enterprise org's fetch fall through to a harmless 404
    // rather than asserting there's exactly one candidate overall.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!url.startsWith('https://ags-acme-registry.example.com/agents/search')) {
        return new Response('not found', { status: 404 });
      }
      return new Response(
        JSON.stringify({
          specVersion: '1.0',
          entries: [
            {
              identifier: 'send-email',
              displayName: 'Send Email Agent',
              mediaType: 'application/a2a-agent-card+json',
              url: 'https://ags-acme-registry.example.com/agents/send-email',
              description: 'Sends a transactional email',
              tags: ['email'],
            },
          ],
        }),
        { status: 200 },
      );
    }));

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/agentic-search?q=send+transactional+email' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ours = body.candidates.find((c: { provenance: { org_id: string } }) => c.provenance.org_id === 'ags-acme');
    // A bare registry identifier is qualified to the paper's urn:air: form,
    // anchored to the (verified) domain of the entry it was found through.
    expect(ours).toMatchObject({
      identifier: 'urn:air:ags-acme.example.com:agent:send-email',
      display_name: 'Send Email Agent',
      publisher: { identifier: 'ags-acme.example.com', identityType: 'dns' },
      url: 'https://ags-acme-registry.example.com/agents/send-email',
      provenance: { org_id: 'ags-acme', basis: 'agent_search' },
    });
  });

  it('returns an SMB/personal org directly as a single candidate, without calling fetch', async () => {
    await seedOrg({
      orgId: 'ags-bakery',
      domain: 'ags-bakery.example.com',
      displayName: 'Moonbakery',
      description: 'Order fresh sourdough bread for pickup',
      tags: ['bakery', 'bread', 'food'],
      mediaType: 'application/a2a-agent-card+json',
      registryUrl: 'https://host39.org/cards/moonbakery',
    });

    // Return a harmless 404 for any OTHER matching enterprise org that may
    // also be sitting in the shared test DB (see the enterprise fan-out test
    // above for why exact-match assertions are unsafe here) — the real
    // assertion is that fetch is never called for OUR org specifically,
    // since it's an SMB card, not a registry.
    const fetchMock = vi.fn(async (_url: string) => new Response('not found', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/agentic-search?q=sourdough+bread' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ourFetchCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('host39.org/cards/moonbakery'));
    expect(ourFetchCalls).toEqual([]);
    const ours = body.candidates.find((c: { provenance: { org_id: string } }) => c.provenance.org_id === 'ags-bakery');
    expect(ours).toMatchObject({
      display_name: 'Moonbakery',
      url: 'https://host39.org/cards/moonbakery',
      provenance: { org_id: 'ags-bakery', basis: 'single_agent_org' },
    });
  });

  it('keeps an already-qualified registry identifier as-is', async () => {
    await seedOrg({
      orgId: 'ags-urn',
      domain: 'ags-urn.example.com',
      displayName: 'Urn Corp',
      description: 'Quantum widget polishing service',
      tags: ['quantum', 'polishing'],
      registryUrl: 'https://ags-urn-registry.example.com',
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!url.startsWith('https://ags-urn-registry.example.com/agents/search')) {
        return new Response('not found', { status: 404 });
      }
      return new Response(JSON.stringify({
        specVersion: '1.0',
        entries: [{
          identifier: 'urn:air:ags-urn.example.com:agent:polisher',
          displayName: 'Polisher', mediaType: 'application/a2a-agent-card+json',
          url: 'https://ags-urn-registry.example.com/agents/polisher',
        }],
      }), { status: 200 });
    }));

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/agentic-search?q=quantum+polishing' });
    const ours = res.json().candidates.find((c: { provenance: { org_id: string } }) => c.provenance.org_id === 'ags-urn');
    expect(ours.identifier).toBe('urn:air:ags-urn.example.com:agent:polisher');
  });

  it('refers to a matching ARD finder instead of returning it as an agent candidate', async () => {
    await seedOrg({
      orgId: 'ags-finder',
      domain: 'ags-finder.example.com',
      displayName: 'Finder Directory',
      description: 'Federated directory of zeppelin charter agents',
      tags: ['zeppelin', 'charter'],
      mediaType: 'application/ai-registry+json',
      registryUrl: 'https://directory.ags-finder.example.com/ard/',
    });
    const fetchMock = vi.fn(async (_url: string) => new Response('not found', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/agentic-search?q=zeppelin+charter' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('ags-finder'))).toEqual([]);
    expect(body.candidates.some((c: { provenance: { org_id: string } }) => c.provenance.org_id === 'ags-finder')).toBe(false);
    expect(body.referrals).toContainEqual({
      identifier: 'urn:air:ags-finder.example.com:catalog:root',
      display_name: 'Finder Directory',
      search_url: 'https://directory.ags-finder.example.com/ard/search',
    });
  });

  it('excludes unreachable enterprise registries from candidates but still reports orgs_unreachable', async () => {
    await seedOrg({
      orgId: 'ags-flaky',
      domain: 'ags-flaky.example.com',
      displayName: 'Flaky Corp',
      description: 'Widget inventory management',
      tags: ['widgets', 'inventory'],
      registryUrl: 'https://ags-flaky-registry.example.com',
    });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/agentic-search?q=widget+inventory' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.candidates.some((c: { provenance: { org_id: string } }) => c.provenance.org_id === 'ags-flaky')).toBe(false);
    expect(body.orgs_unreachable).toContain('ags-flaky');
  });

  it('with the SSRF guard on, never fetches a registry pointing at an internal address', async () => {
    await seedOrg({
      orgId: 'ags-internal',
      domain: 'ags-internal.example.com',
      displayName: 'Internal Corp',
      description: 'Quokka grooming appointments',
      tags: ['quokka', 'grooming'],
      registryUrl: 'http://127.0.0.1:6379',
    });
    const fetchMock = vi.fn(async (_url: string) => new Response('not found', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'] = 'false';
    try {
      const res = await fastify.inject({ method: 'GET', url: '/api/v1/agentic-search?q=quokka+grooming' });

      expect(res.statusCode).toBe(200);
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('127.0.0.1'))).toEqual([]);
      expect(res.json().orgs_unreachable).toContain('ags-internal');
    } finally {
      process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'] = 'true';
    }
  });

  it('response shape matches the agentic-search schema', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/agentic-search?q=anything' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.query).toBe('string');
    expect(typeof body.count).toBe('number');
    expect(Array.isArray(body.candidates)).toBe(true);
    expect(typeof body.orgs_queried).toBe('number');
    expect(Array.isArray(body.orgs_unreachable)).toBe(true);
    expect(Array.isArray(body.referrals)).toBe(true);
    expect(typeof body.took_ms).toBe('number');
  });
});
