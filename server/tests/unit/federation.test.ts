import { describe, it, expect, afterEach, vi } from 'vitest';
import { maybeFederateOut } from '../../src/services/federation.js';
import type { AgentCandidate } from '../../src/types/api/agentic-search.js';
import type { FederationConfig } from '../../src/config/index.js';

function makeCandidate(overrides: Partial<AgentCandidate> = {}): AgentCandidate {
  return {
    identifier: 'local-1',
    display_name: 'Local Agent',
    type: 'application/a2a-agent-card+json',
    url: 'https://local.example.com/agent',
    description: 'A local candidate',
    tags: ['local'],
    provenance: { org_id: 'local-org', registry_url: 'https://local.example.com', basis: 'single_agent_org' },
    score: 0.9,
    ...overrides,
  };
}

function cfg(overrides: Partial<FederationConfig> = {}): FederationConfig {
  return {
    mode: 'none',
    upstreamUrl: 'https://ora.ai/api/ard/search',
    upstreamName: 'ora.ai',
    thinResultThreshold: 3,
    timeoutMs: 2000,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('maybeFederateOut', () => {
  it('mode "none" is a no-op regardless of result count', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await maybeFederateOut('query', [], cfg({ mode: 'none' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ candidates: [], referrals: [], federated: false });
  });

  it('mode "referrals" attaches an upstream pointer without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const local = [makeCandidate()];

    const result = await maybeFederateOut('query', local, cfg({ mode: 'referrals' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.candidates).toBe(local);
    expect(result.referrals).toEqual([{ displayName: 'ora.ai', searchUrl: 'https://ora.ai/api/ard/search' }]);
    expect(result.federated).toBe(false);
  });

  it('mode "auto" skips fetching when local results already meet the threshold', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const local = [makeCandidate(), makeCandidate({ identifier: 'local-2' }), makeCandidate({ identifier: 'local-3' })];

    const result = await maybeFederateOut('query', local, cfg({ mode: 'auto', thinResultThreshold: 3 }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.federated).toBe(false);
  });

  it('mode "auto" fetches and merges when local results are thin, deduping by identifier', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        results: [
          { identifier: 'local-1', displayName: 'Duplicate of local', type: 'x', url: 'https://x', score: 1 },
          { identifier: 'upstream-1', displayName: 'Upstream Agent', type: 'application/mcp-server-card+json', url: 'https://ora.ai/agent', description: 'from ora', tags: ['ora'] },
        ],
      }),
      { status: 200 },
    )));

    const local = [makeCandidate()];
    const result = await maybeFederateOut('query', local, cfg({ mode: 'auto', thinResultThreshold: 3 }));

    expect(result.federated).toBe(true);
    expect(result.candidates).toHaveLength(2); // local-1 kept once, upstream-1 added; duplicate upstream "local-1" dropped
    expect(result.candidates.map((c) => c.identifier).sort()).toEqual(['local-1', 'upstream-1']);
    const upstream = result.candidates.find((c) => c.identifier === 'upstream-1')!;
    expect(upstream.provenance.basis).toBe('federated');
    expect(upstream.provenance.org_id).toBe('ora.ai');
  });

  it('mode "auto" falls back to a referral when the upstream is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network error'); }));

    const result = await maybeFederateOut('query', [], cfg({ mode: 'auto', thinResultThreshold: 3 }));
    expect(result.federated).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.referrals).toEqual([{ displayName: 'ora.ai', searchUrl: 'https://ora.ai/api/ard/search' }]);
  });

  it('mode "auto" falls back to a referral on a non-2xx upstream response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));

    const result = await maybeFederateOut('query', [], cfg({ mode: 'auto', thinResultThreshold: 3 }));
    expect(result.federated).toBe(false);
    expect(result.referrals).toHaveLength(1);
  });
});
