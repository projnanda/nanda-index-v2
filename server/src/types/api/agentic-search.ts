import { TRUST_MANIFEST_SCHEMA, type TrustManifest } from './index-record.js';

/** One ranked candidate agent returned by GET /api/v1/agentic-search. */
export interface AgentCandidate {
  identifier: string;
  display_name: string;
  type: string;
  url: string;
  description: string | null;
  tags: string[];
  trust_manifest?: TrustManifest;
  provenance: {
    org_id: string;
    registry_url: string;
    basis: 'agent_search' | 'single_agent_org' | 'federated';
  };
  score: number;
}

/** GET /api/v1/agentic-search?q=&limit= — response envelope. */
export interface AgenticSearchResponse {
  query: string;
  count: number;
  candidates: AgentCandidate[];
  resolved: AgentCandidate | null;
  orgs_queried: number;
  orgs_unreachable: string[];
  took_ms: number;
}

export const agenticSearchQuerySchema = {
  type: 'object',
  required: ['q'],
  additionalProperties: false,
  properties: {
    q:     { type: 'string', minLength: 2, maxLength: 128 },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  },
} as const;

const AGENT_CANDIDATE_SCHEMA = {
  type: 'object',
  required: ['identifier', 'display_name', 'type', 'url', 'description', 'tags', 'provenance', 'score'],
  properties: {
    identifier:   { type: 'string' },
    display_name: { type: 'string' },
    type:         { type: 'string' },
    url:          { type: 'string' },
    description:  { type: ['string', 'null'] },
    tags:         { type: 'array', items: { type: 'string' } },
    trust_manifest: TRUST_MANIFEST_SCHEMA,
    provenance: {
      type: 'object',
      required: ['org_id', 'registry_url', 'basis'],
      properties: {
        org_id:       { type: 'string' },
        registry_url: { type: 'string' },
        basis:        { type: 'string', enum: ['agent_search', 'single_agent_org', 'federated'] },
      },
    },
    score: { type: 'number' },
  },
} as const;

export const agenticSearchResponseSchema = {
  type: 'object',
  required: ['query', 'count', 'candidates', 'resolved', 'orgs_queried', 'orgs_unreachable', 'took_ms'],
  additionalProperties: false,
  properties: {
    query:             { type: 'string' },
    count:             { type: 'integer', minimum: 0 },
    candidates:        { type: 'array', items: AGENT_CANDIDATE_SCHEMA },
    resolved:          { anyOf: [AGENT_CANDIDATE_SCHEMA, { type: 'null' }] },
    orgs_queried:      { type: 'integer', minimum: 0 },
    orgs_unreachable:  { type: 'array', items: { type: 'string' } },
    took_ms:           { type: 'integer', minimum: 0 },
  },
} as const;
