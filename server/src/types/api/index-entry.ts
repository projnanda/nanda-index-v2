import { EXTENSIONS_SCHEMA, TRUST_MANIFEST_SCHEMA, type PublisherBlock, type TrustManifest } from './index-record.js';

/**
 * An index record in the switchboard paper's AI Catalog entry shape (§6):
 * `type`, `url` XOR inline `data`, a bare-domain `publisher`, and routing
 * hints under `extensions`. NANDA operational state (orgId, status,
 * ttlSeconds, emailVerified, domainVerified, createdAt, domain,
 * representativeQueries) is surfaced read-only under
 * `extensions["org.projectnanda"]` — "metadata required for interpretation
 * and trust" (§5.2). Served by GET /api/v1/index and /api/v1/index/:org_id.
 */
export interface IndexEntry {
  identifier: string;
  displayName: string;
  type: string;
  url?: string;
  data?: Record<string, unknown>;
  description?: string;
  tags: string[];
  version?: string;
  publisher?: PublisherBlock;
  trustManifest?: TrustManifest;
  updatedAt: string;
  extensions: Record<string, Record<string, unknown>>;
}

export const INDEX_ENTRY_SCHEMA = {
  type: 'object',
  required: ['identifier', 'displayName', 'type', 'tags', 'updatedAt', 'extensions'],
  additionalProperties: false,
  properties: {
    identifier:  { type: 'string' },
    displayName: { type: 'string' },
    type:        { type: 'string' },
    url:         { type: 'string' },
    data:        { type: 'object', additionalProperties: true },
    description: { type: 'string' },
    tags:        { type: 'array', items: { type: 'string' } },
    version:     { type: 'string' },
    publisher: {
      type: 'object',
      properties: {
        identifier:   { type: 'string' },
        displayName:  { type: 'string' },
        identityType: { type: 'string' },
      },
    },
    trustManifest: TRUST_MANIFEST_SCHEMA,
    updatedAt:     { type: 'string' },
    extensions:    EXTENSIONS_SCHEMA,
  },
} as const;
