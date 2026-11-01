import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  fanOutAgentSearch, isCatalogDocumentUrl, searchCatalogEntries, wellKnownCatalogUrl,
} from '../../src/services/registryFanout.js';
import { allowAnyUrl, OutboundUrlError } from '../../src/lib/outboundUrl.js';
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
    everProven: true,
    ttlSeconds: 86400,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    identifier: 'urn:air:default.example.com:catalog:root',
    mediaType: 'application/ai-catalog+json',
    description: 'A default org',
    tags: ['default'],
    publisher: null,
    extensions: { 'org.projectnanda': {} },
    entryData: null,
    version: null,
    trustManifest: null,
    representativeQueries: [],
    moderation: 'none',
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

    const result = await fanOutAgentSearch([org], 'send email', { urlGuard: allowAnyUrl });

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

    const result = await fanOutAgentSearch([org], 'query', { urlGuard: allowAnyUrl, perOrgLimit: 2 });
    expect(result.candidates).toHaveLength(2);
  });

  it('marks an org unreachable on a non-2xx response, without failing the whole fan-out', async () => {
    const okOrg = makeOrg({ orgId: 'ent-ok', mediaType: 'application/ai-catalog+json' });
    const badOrg = makeOrg({ orgId: 'ent-bad', mediaType: 'application/ai-catalog+json', registryUrl: 'https://bad.example.com' });

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('https://bad.example.com')) return new Response('nope', { status: 500 });
      return new Response(JSON.stringify({ specVersion: '1.0', entries: [{ identifier: 'a', displayName: 'A', mediaType: 'application/a2a-agent-card+json', url: 'https://x' }] }), { status: 200 });
    }));

    const result = await fanOutAgentSearch([okOrg, badOrg], 'query', { urlGuard: allowAnyUrl });
    expect(result.unreachable).toEqual(['ent-bad']);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.org.orgId).toBe('ent-ok');
  });

  it('marks an org unreachable on malformed JSON (missing entries array)', async () => {
    const org = makeOrg({ orgId: 'ent-malformed', mediaType: 'application/ai-catalog+json' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ oops: true }), { status: 200 })));

    const result = await fanOutAgentSearch([org], 'query', { urlGuard: allowAnyUrl });
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

    const result = await fanOutAgentSearch([org], 'query', { urlGuard: allowAnyUrl, timeoutMs: 30 });
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

    const result = await fanOutAgentSearch([smbOrg], 'bread', { urlGuard: allowAnyUrl });

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

  it('does not call fetch for a DNS SVCB pointer — synthesizes a single candidate from its own record', async () => {
    const dnsOrg = makeOrg({
      orgId: 'dns-acme',
      mediaType: 'application/a2a-agent-card+json',
      registryUrl: 'https://api.acme.com/agents/refunds.json',
      extensions: { 'org.projectnanda': { resolutionRole: 'dns-svcb-pointer', preferredDiscovery: 'dns-svcb' } },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fanOutAgentSearch([dnsOrg], 'query', { urlGuard: allowAnyUrl });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.basis).toBe('single_agent_org');
  });

  it('returns an ARD finder (ai-registry) as a finder to refer to — no fetch, no synthesized candidate', async () => {
    const finder = makeOrg({
      orgId: 'acme-ard',
      mediaType: 'application/ai-registry+json',
      registryUrl: 'https://directory.acme.com/ard',
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fanOutAgentSearch([finder], 'query', { urlGuard: allowAnyUrl });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.candidates).toEqual([]);
    expect(result.finders.map((f) => f.orgId)).toEqual(['acme-ard']);
  });

  it('skips a pointer-only registry (ANS) entirely — no fetch, no synthesized candidate', async () => {
    const ansOrg = makeOrg({
      orgId: 'godaddy-ans',
      mediaType: 'application/vnd.ans-registry+json',
      registryUrl: 'https://ans.godaddy.com',
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fanOutAgentSearch([ansOrg], 'query', { urlGuard: allowAnyUrl });

    // The index points at ANS but never resolves into it: neither a fan-out
    // call nor a single-agent synthesis — it contributes nothing.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.candidates).toHaveLength(0);
    expect(result.unreachable).toHaveLength(0);
    expect(result.finders).toHaveLength(0);
  });

  it('serves a pointer-only ANS org alongside others without affecting them', async () => {
    const ansOrg = makeOrg({ orgId: 'ans-x', mediaType: 'application/vnd.ans-registry+json', registryUrl: 'https://ans.example.com' });
    const smbOrg = makeOrg({ orgId: 'smb-y', mediaType: 'application/a2a-agent-card+json', registryUrl: 'https://smb.example.com' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fanOutAgentSearch([ansOrg, smbOrg], 'query', { urlGuard: allowAnyUrl });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.candidates.map((c) => c.org.orgId)).toEqual(['smb-y']);
  });

  it('never fetches a registry whose URL fails the SSRF guard — it is reported unreachable', async () => {
    const org = makeOrg({ orgId: 'ssrf', mediaType: 'application/ai-catalog+json', registryUrl: 'http://169.254.169.254' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const guard = vi.fn(async (url: string) => { throw new OutboundUrlError(`blocked ${url}`); });

    const result = await fanOutAgentSearch([org], 'query', { urlGuard: guard });

    expect(guard).toHaveBeenCalledWith('http://169.254.169.254/agents/search?q=query');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.unreachable).toEqual(['ssrf']);
  });

  it('fetches through the guard-returned fetch (pinned to the checked addresses), never the global one', async () => {
    const org = makeOrg({ orgId: 'pinned', mediaType: 'application/ai-catalog+json', registryUrl: 'https://pinned.example.com' });
    const globalFetch = vi.fn();
    vi.stubGlobal('fetch', globalFetch);
    const pinned = vi.fn(async () => new Response(JSON.stringify({ specVersion: '1.0', entries: [] }), { status: 200 }));
    const guard = vi.fn(async () => pinned);

    const result = await fanOutAgentSearch([org], 'query', { urlGuard: guard });

    expect(pinned).toHaveBeenCalledWith('https://pinned.example.com/agents/search?q=query', expect.objectContaining({ redirect: 'error' }));
    expect(globalFetch).not.toHaveBeenCalled();
    expect(result.unreachable).toEqual([]);
  });

  it('refuses redirects, so a public registry cannot bounce the server to an internal host', async () => {
    const org = makeOrg({ orgId: 'redir', mediaType: 'application/ai-catalog+json', registryUrl: 'https://redir.example.com' });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ specVersion: '1.0', entries: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await fanOutAgentSearch([org], 'query', { urlGuard: allowAnyUrl });

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
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

    const result = await fanOutAgentSearch(orgs, 'query', { urlGuard: allowAnyUrl, concurrency: 2 });
    expect(result.unreachable).toEqual(['ent-a']);
    expect(result.candidates.map((c) => c.org.orgId).sort()).toEqual(['ent-b', 'smb-c']);
  });
});

describe('fanOutAgentSearch — static catalog documents (#52)', () => {
  const card = 'application/a2a-agent-card+json';
  const catalog = (entries: unknown[]) =>
    new Response(JSON.stringify({ specVersion: '1.0', entries }), { status: 200 });

  it('searches a registry_url that is itself a catalog document locally, never appending /agents/search', async () => {
    const org = makeOrg({
      orgId: 'static-doc', domain: 'static.example.com',
      registryUrl: 'https://static.example.com/.well-known/ai-catalog.json',
    });
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://static.example.com/.well-known/ai-catalog.json');
      return catalog([
        { identifier: 'flights', displayName: 'Flight Booking', mediaType: card, url: 'https://static.example.com/flights' },
        { identifier: 'hotels', displayName: 'Hotel Desk', mediaType: card, url: 'https://static.example.com/hotels' },
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fanOutAgentSearch([org], 'Find flight booking agents', { urlGuard: allowAnyUrl });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.unreachable).toEqual([]);
    expect(result.candidates.map((c) => c.entry.identifier)).toEqual(['flights']);
  });

  it('falls back to the origin\'s well-known catalog when a registry base has no /agents/search', async () => {
    const org = makeOrg({ orgId: 'no-api', domain: 'noapi.example.com', registryUrl: 'https://noapi.example.com' });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://noapi.example.com/agents/search')) return new Response('not found', { status: 404 });
      expect(url).toBe('https://noapi.example.com/.well-known/ai-catalog.json');
      return catalog([{ identifier: 'verifier', displayName: 'Verifier', mediaType: card,
        url: 'https://noapi.example.com/cards/verifier.json', tags: ['identity'] }]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fanOutAgentSearch([org], 'identity verifier', { urlGuard: allowAnyUrl });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.unreachable).toEqual([]);
    expect(result.candidates.map((c) => c.entry.identifier)).toEqual(['verifier']);
  });

  it('reports a reachable static catalog with no matching entries as reachable, with no candidates', async () => {
    const org = makeOrg({ orgId: 'static-miss', domain: 'miss.example.com',
      registryUrl: 'https://miss.example.com/ai-catalog.json' });
    vi.stubGlobal('fetch', vi.fn(async () =>
      catalog([{ identifier: 'mail', displayName: 'Mail Agent', mediaType: card, url: 'https://miss.example.com/mail' }])));

    const result = await fanOutAgentSearch([org], 'flight booking', { urlGuard: allowAnyUrl });

    expect(result.unreachable).toEqual([]);
    expect(result.candidates).toEqual([]);
  });

  it('still marks an org unreachable when neither the search API nor the well-known catalog answers', async () => {
    const org = makeOrg({ orgId: 'dead', registryUrl: 'https://dead.example.com/registry' });
    const fetchMock = vi.fn(async (_url: string) => new Response('gone', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fanOutAgentSearch([org], 'flights', { urlGuard: allowAnyUrl });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://dead.example.com/registry/agents/search?q=flights',
      'https://dead.example.com/.well-known/ai-catalog.json',
    ]);
    expect(result.unreachable).toEqual(['dead']);
  });
});

describe('catalog URL helpers', () => {
  it('tells a catalog document from a registry API base', () => {
    expect(isCatalogDocumentUrl('https://noinfra.ai/.well-known/ai-catalog.json')).toBe(true);
    expect(isCatalogDocumentUrl('https://x.example.com/catalog.JSON?v=2')).toBe(true);
    expect(isCatalogDocumentUrl('https://travel26.net/api')).toBe(false);
    expect(isCatalogDocumentUrl('https://solara.associates')).toBe(false);
    expect(isCatalogDocumentUrl('not a url')).toBe(false);
  });

  it('derives the well-known catalog from any URL on the origin', () => {
    expect(wellKnownCatalogUrl('https://travel26.net/api/')).toBe('https://travel26.net/.well-known/ai-catalog.json');
    expect(wellKnownCatalogUrl('https://solara.associates')).toBe('https://solara.associates/.well-known/ai-catalog.json');
  });

  it('ranks entries by query words matched, ignoring stop words and plurals', () => {
    const entry = (identifier: string, displayName: string, description?: string) =>
      ({ identifier, displayName, mediaType: 'application/a2a-agent-card+json', url: `https://x/${identifier}`, description });
    const entries = [entry('hotels', 'Hotel Desk'), entry('flights', 'Flight Booking'), entry('alerts', 'Travel Alerts', 'flight delays')];

    expect(searchCatalogEntries(entries, 'Find flight booking agents').map((e) => e.identifier)).toEqual(['flights', 'alerts']);
    expect(searchCatalogEntries(entries, 'find agents')).toEqual([]);
  });
});
