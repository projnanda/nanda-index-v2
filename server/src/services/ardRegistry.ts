import type { Config } from '../config/index.js';
import type { Organization } from '../db/queries/organizations.js';
import type { AgentCandidate } from '../types/api/agentic-search.js';
import type { ArdRegistryDescriptor, ArdSearchResultItem } from '../types/api/ard.js';
import { NANDA_TO_ARD_TYPE, toArdType } from '../lib/ardMapping.js';

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** Builds the ARD registry descriptor served at GET /api/ard, in the same
 *  shape ora.ai's own descriptor uses (specVersion/registry/endpoints/
 *  mediaTypes/capabilities/links). */
export function buildDescriptor(config: Config): ArdRegistryDescriptor {
  const base = config.apiBaseUrl.replace(/\/+$/, '');
  const host = hostOf(config.apiBaseUrl);

  const mediaTypes = Array.from(new Set(Object.values(NANDA_TO_ARD_TYPE))).map((type) => ({
    type,
    label: type,
  }));

  const upstreams =
    config.federation.mode === 'none'
      ? []
      : [
          {
            identifier: `urn:air:${config.federation.upstreamName}:registry:discovery`,
            displayName: config.federation.upstreamName,
            url: config.federation.upstreamUrl,
          },
        ];

  return {
    specVersion: '1.0',
    type: 'application/ai-registry+json',
    identifier: `urn:air:nanda-index:${host}`,
    registry: {
      displayName: 'NANDA Index',
      identity: `did:web:${host}`,
      description:
        'NANDA Index — federated agent discovery. Ranks candidate organizations locally and fans out live to their registries (enterprise, SMB/personal, DNS-AID) for agent-level search results.',
      documentationUrl: `${base}/docs`,
    },
    endpoints: {
      search: {
        method: 'POST',
        url: `${base}/api/ard/search`,
        requestType: 'application/json',
        description: 'Natural-language relevance search with optional type filter and federation.',
      },
      explore: {
        method: 'POST',
        url: `${base}/api/ard/explore`,
        requestType: 'application/json',
        description: 'Facet aggregations (counts per media type / tag) over active organizations.',
      },
      agents: {
        method: 'GET',
        url: `${base}/api/ard/agents`,
        description: 'Deterministic, cacheable org-level listing with a single-term filter, pageSize, and pageToken.',
      },
    },
    mediaTypes,
    capabilities: {
      agentsFilterFields: ['type', 'tags'],
      searchFilterFields: ['type'],
      orderByFields: ['identifier'],
      facetFields: ['type', 'tags'],
      pagination: { style: 'pageToken', maxPageSize: 100 },
      federation: {
        modes: ['none', 'referrals', 'auto'],
        autoFanoutEnabled: false,
        upstreams,
      },
    },
  };
}

/** Maps a NANDA-native AgentCandidate (snake_case) to an ARD search result
 *  (camelCase) — the two /api/v1 and /api/ard surfaces share the same
 *  underlying agenticSearch() pipeline and only differ in wire casing. */
export function agentCandidateToArdResult(c: AgentCandidate): ArdSearchResultItem {
  return {
    identifier: c.identifier,
    displayName: c.display_name,
    type: c.type,
    url: c.url,
    description: c.description,
    tags: c.tags,
    provenance: {
      orgId: c.provenance.org_id,
      registryUrl: c.provenance.registry_url,
      basis: c.provenance.basis,
    },
    score: c.score,
  };
}

/** Maps an org-level Organization row to an ARD result item — backs
 *  GET /api/ard/agents, which is scoped to organizations (see plan's Open
 *  Tradeoffs #1: a true per-agent listing would require fanning out on
 *  every page request, which is a crawl in disguise). */
export function organizationToArdResult(org: Organization): ArdSearchResultItem {
  return {
    identifier: org.identifier ?? org.orgId,
    displayName: org.displayName,
    type: toArdType(org.mediaType),
    url: org.registryUrl ?? '',
    description: org.description,
    tags: org.tags,
    provenance: {
      orgId: org.orgId,
      registryUrl: org.registryUrl ?? '',
      basis: 'org_listing',
    },
    score: 0,
  };
}
