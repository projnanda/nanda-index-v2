import { describe, it, expect, afterEach, vi } from 'vitest';
import { fanOutAgentSearch } from '../../src/services/registryFanout.js';
import type { RankedOrganization } from '../../src/db/queries/organizations.js';

function makeOrg(overrides: Partial<RankedOrganization>): RankedOrganization {
  return {
    id: 'id-' + Math.random(),
    orgId: 'org-default',
    displayName: 'Default Org',
    domain: 'default.example.com',
    contactEmail: 'admin@default.example.com',
    registryUrl: 'https://default.example.com/registry',
    emailVerified: true,
    verifyToken: null,
    verifyTokenExpiresAt: null,
    domainVerified: true,
    domainChallenge: null,
    domainChallengeExpiresAt: null,
    domainVerifiedAt: new Date(),
    ttlSeconds: 86400,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    identifier: 'urn:ai:domain:default.example.com',
    mediaType: 'application/ai-catalog+json',
    description: 'A default org',
    tags: ['default'],
    publisher: null,
    catalogMetadata: null,
    entryData: null,
    version: null,
    trustManifest: null,
    representativeQueries: [],
    rank: 1,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fanOutAgentSearch', () => {
  it('fans out to an enterprise org\'s /agents/search and maps entries with basis "agent_search"', async () => {
    const org = makeOrg({
      orgId: 'ent-1',
      mediaType: 'application/ai-catalog+json',
      registryUrl: 'https://ent1.example.com',
    });

    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://ent1.example.com/agents/search?q=send%20email');
      return new Response(
        JSON.stringify({
          specVersion: '1.0',
          entries: [
            { identifier: 'flights', displayName: 'Flights Agent', mediaType: 'application/a2a-agent-card+json', url: 'https://ent1.example.com/agents/flights' },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fanOutAgentSearch([org], 'send email');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.unreachable).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.basis).toBe('agent_search');
    expect(result.candidates[0]!.entry.identifier).toBe('flights');
    expect(result.candidates[0]!.org.orgId).toBe('ent-1');
  });

  it('caps fanned-out entries at perOrgLimit', async () => {
    const org = makeOrg({ orgId: 'ent-many', mediaType: 'application/ai-catalog+json' });
    const entries = Array.from({ length: 5 }, (_, i) => ({
      identifier: `agent-${i}`, displayName: `Agent ${i}`, mediaType: 'application/a2a-agent-card+json', url: `https://x/${i}`,
    }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ specVersion: '1.0', entries }), { status: 200 })));

    const result = await fanOutAgentSearch([org], 'query', { perOrgLimit: 2 });
    expect(result.candidates).toHaveLength(2);
  });

  it('marks an org unreachable on a non-2xx response, without failing the whole fan-out', async () => {
    const okOrg = makeOrg({ orgId: 'ent-ok', mediaType: 'application/ai-catalog+json' });
    const badOrg = makeOrg({ orgId: 'ent-bad', mediaType: 'application/ai-catalog+json', registryUrl: 'https://bad.example.com' });

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('https://bad.example.com')) return new Response('nope', { status: 500 });
      return new Response(JSON.stringify({ specVersion: '1.0', entries: [{ identifier: 'a', displayName: 'A', mediaType: 'application/a2a-agent-card+json', url: 'https://x' }] }), { status: 200 });
    }));

    const result = await fanOutAgentSearch([okOrg, badOrg], 'query');
    expect(result.unreachable).toEqual(['ent-bad']);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.org.orgId).toBe('ent-ok');
  });

  it('marks an org unreachable on malformed JSON (missing entries array)', async () => {
    const org = makeOrg({ orgId: 'ent-malformed', mediaType: 'application/ai-catalog+json' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ oops: true }), { status: 200 })));

    const result = await fanOutAgentSearch([org], 'query');
    expect(result.unreachable).toEqual(['ent-malformed']);
    expect(result.candidates).toEqual([]);
  });

  it('marks an org unreachable when the request times out', async () => {
    const org = makeOrg({ orgId: 'ent-slow', mediaType: 'application/ai-catalog+json' });
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }));

    const result = await fanOutAgentSearch([org], 'query', { timeoutMs: 30 });
    expect(result.unreachable).toEqual(['ent-slow']);
  });

  it('does not call fetch for a non-enterprise org — synthesizes a single candidate from its own record', async () => {
    const smbOrg = makeOrg({
      orgId: 'smb-bakery',
      mediaType: 'application/a2a-agent-card+json',
      registryUrl: 'https://host39.org/cards/bakery',
      displayName: 'Moonbakery',
      description: 'Order fresh bread',
      tags: ['bakery', 'food'],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fanOutAgentSearch([smbOrg], 'bread');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.basis).toBe('single_agent_org');
    expect(result.candidates[0]!.entry).toMatchObject({
      identifier: smbOrg.identifier,
      displayName: 'Moonbakery',
      url: 'https://host39.org/cards/bakery',
      description: 'Order fresh bread',
      tags: ['bakery', 'food'],
    });
  });

  it('does not call fetch for a DNS-AID org — synthesizes a single candidate from its own record', async () => {
    const dnsOrg = makeOrg({
      orgId: 'dns-acme',
      mediaType: 'application/vnd.dns-aid+json',
      registryUrl: 'https://acme.com',
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fanOutAgentSearch([dnsOrg], 'query');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.basis).toBe('single_agent_org');
  });

  it('isolates failures per-org under concurrency — one bad registry does not affect others', async () => {
    const orgs = [
      makeOrg({ orgId: 'ent-a', mediaType: 'application/ai-catalog+json', registryUrl: 'https://a.example.com' }),
      makeOrg({ orgId: 'ent-b', mediaType: 'application/ai-catalog+json', registryUrl: 'https://b.example.com' }),
      makeOrg({ orgId: 'smb-c', mediaType: 'application/a2a-agent-card+json', registryUrl: 'https://c.example.com' }),
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('https://a.example.com')) throw new Error('network error');
      return new Response(JSON.stringify({ specVersion: '1.0', entries: [{ identifier: 'b1', displayName: 'B1', mediaType: 'application/a2a-agent-card+json', url: 'https://b.example.com/b1' }] }), { status: 200 });
    }));

    const result = await fanOutAgentSearch(orgs, 'query', { concurrency: 2 });
    expect(result.unreachable).toEqual(['ent-a']);
    expect(result.candidates.map((c) => c.org.orgId).sort()).toEqual(['ent-b', 'smb-c']);
  });
});
