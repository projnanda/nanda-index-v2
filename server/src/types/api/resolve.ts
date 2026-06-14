import type { IndexRecord } from './index-record.js';
import { INDEX_RECORD_SCHEMA } from './index-record.js';

/**
 * Components of a parsed URN agent locator.
 * Canonical format: urn:<nid>:<domain>:<identifier>   (e.g. urn:ai:nasiko.com:ankit)
 * host39 extended form: urn:<nid>:(domain|email):<authority>:agent:<slug>
 *   e.g. urn:ai:domain:moonbakery.com:agent:orders -> domain=moonbakery.com, identifier=orders
 * For email authorities, `domain` holds the email; the index has no email
 * lookup yet, so those resolve to not_found.
 */
export interface ParsedLocator {
  readonly urn: string;        // full URN, e.g. "urn:ai:nasiko.com:ankit"
  readonly nid: string;        // namespace identifier, e.g. "ai"
  readonly domain: string;     // org domain (or email authority) component
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
