import type { IndexRecord } from './index-record.js';
import { INDEX_RECORD_SCHEMA } from './index-record.js';

/**
 * Components of a parsed URN agent locator.
 * Format: urn:<nid>:<domain>:<identifier>
 * Example: urn:ai:nasiko.com:ankit
 */
export interface ParsedLocator {
  readonly urn: string;        // full URN, e.g. "urn:ai:nasiko.com:ankit"
  readonly nid: string;        // namespace identifier, e.g. "ai"
  readonly domain: string;     // org domain component, e.g. "nasiko.com"
  readonly identifier: string; // local agent id, e.g. "ankit"
}

/**
 * Successful response from GET /api/v1/resolve.
 * Returns the IndexRecord from the NANDA Index plus the parsed identifier.
 * The caller fetches the AgentRecord directly: GET <index_record.registry_url>/agents/<identifier>
 */
export interface ResolveResponse {
  readonly locator: string;
  readonly identifier: string;
  readonly index_record: IndexRecord;
}

export { IndexRecord };

export const resolveResponseSchema = {
  type: 'object',
  required: ['locator', 'identifier', 'index_record'],
  properties: {
    locator: { type: 'string', minLength: 1 },
    identifier: { type: 'string', minLength: 1 },
    index_record: INDEX_RECORD_SCHEMA,
  },
} as const;
