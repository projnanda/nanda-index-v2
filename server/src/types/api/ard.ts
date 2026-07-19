/**
 * ARD (Agentic Resource Discovery) wire types — deliberately camelCase to
 * stay byte-compatible with ora.ai's reference implementation, unlike every
 * other NANDA-native type in this directory (snake_case). This is an
 * intentional two-casing-conventions split: /api/ard/* speaks ARD's wire
 * format; /api/v1/* speaks NANDA's own. Don't unify them.
 */

export interface ArdRegistryDescriptor {
  specVersion: string;
  type: string;
  identifier: string;
  registry: {
    displayName: string;
    identity: string;
    description: string;
    documentationUrl?: string;
  };
  endpoints: {
    search: { method: string; url: string; requestType: string; description: string };
    explore: { method: string; url: string; requestType: string; description: string };
    agents: { method: string; url: string; description: string };
  };
  mediaTypes: Array<{ type: string; label: string }>;
  capabilities: {
    agentsFilterFields: string[];
    searchFilterFields: string[];
    orderByFields: string[];
    facetFields: string[];
    pagination: { style: string; maxPageSize: number };
    federation: {
      modes: string[];
      autoFanoutEnabled: boolean;
      upstreams: Array<{ identifier: string; displayName: string; url: string }>;
    };
  };
}

export interface ArdSearchResultItem {
  identifier: string;
  displayName: string;
  type: string;
  url: string;
  description?: string | null;
  tags?: string[];
  provenance?: { orgId: string; registryUrl: string; basis: string };
  score: number;
}

export interface ArdReferral {
  displayName: string;
  searchUrl: string;
}

export interface ArdSearchResponse {
  results: ArdSearchResultItem[];
  referrals: ArdReferral[];
  pageToken: string | null;
}

export interface ArdExploreResponse {
  resultType: 'facets';
  scope: 'organizations';
  facets: Record<string, { buckets: Array<{ value: string; count: number }> }>;
}

export interface ArdAgentsResponse {
  items: ArdSearchResultItem[];
  pageToken: string | null;
}

const ARD_SEARCH_RESULT_ITEM_SCHEMA = {
  type: 'object',
  required: ['identifier', 'displayName', 'type', 'url', 'score'],
  additionalProperties: true,
  properties: {
    identifier: { type: 'string' },
    displayName: { type: 'string' },
    type: { type: 'string' },
    url: { type: 'string' },
    description: { type: ['string', 'null'] },
    tags: { type: 'array', items: { type: 'string' } },
    provenance: { type: 'object', additionalProperties: true },
    score: { type: 'number' },
  },
} as const;

export const ardSearchBodySchema = {
  type: 'object',
  required: ['query'],
  additionalProperties: true,
  properties: {
    query: {
      type: 'object',
      required: ['text'],
      additionalProperties: true,
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 512 },
        filter: {
          type: 'object',
          additionalProperties: true,
          properties: {
            type: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
  },
} as const;

export const ardSearchResponseSchema = {
  type: 'object',
  required: ['results', 'referrals', 'pageToken'],
  additionalProperties: false,
  properties: {
    results: { type: 'array', items: ARD_SEARCH_RESULT_ITEM_SCHEMA },
    referrals: {
      type: 'array',
      items: {
        type: 'object',
        required: ['displayName', 'searchUrl'],
        properties: { displayName: { type: 'string' }, searchUrl: { type: 'string' } },
      },
    },
    pageToken: { type: ['string', 'null'] },
  },
} as const;

export const ardExploreBodySchema = {
  type: 'object',
  required: ['resultType'],
  additionalProperties: true,
  properties: {
    resultType: {
      type: 'object',
      required: ['facets'],
      properties: {
        facets: {
          type: 'array',
          items: {
            type: 'object',
            required: ['field'],
            properties: { field: { type: 'string', enum: ['type', 'tags'] } },
          },
        },
      },
    },
  },
} as const;

export const ardExploreResponseSchema = {
  type: 'object',
  required: ['resultType', 'scope', 'facets'],
  additionalProperties: false,
  properties: {
    resultType: { type: 'string', enum: ['facets'] },
    scope: { type: 'string', enum: ['organizations'] },
    facets: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        required: ['buckets'],
        properties: {
          buckets: {
            type: 'array',
            items: {
              type: 'object',
              required: ['value', 'count'],
              properties: { value: { type: 'string' }, count: { type: 'integer' } },
            },
          },
        },
      },
    },
  },
} as const;

export const ardAgentsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    filter: { type: 'string', maxLength: 256 },
    orderBy: { type: 'string' },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    pageToken: { type: 'string' },
  },
} as const;

export const ardAgentsResponseSchema = {
  type: 'object',
  required: ['items', 'pageToken'],
  additionalProperties: false,
  properties: {
    items: { type: 'array', items: ARD_SEARCH_RESULT_ITEM_SCHEMA },
    pageToken: { type: ['string', 'null'] },
  },
} as const;
