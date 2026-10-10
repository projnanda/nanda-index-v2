import type { IndexRecord } from './index-record.js';
import { INDEX_RECORD_SCHEMA } from './index-record.js';

/**
 * How the locator was matched:
 *   exact     — an entry is registered under exactly this identifier.
 *   publisher — no exact entry; the publisher's catalog/registry entry is
 *               returned so the requester can look the resource up inside it.
 */
export type ResolveMatch = 'exact' | 'publisher';

export interface ResolveResponse {
  /** The normalised urn:air: identifier that was resolved. */
  readonly locator: string;
  /** The locator's short-name — the key to look up inside a catalog on a publisher match. */
  readonly identifier: string;
  readonly match: ResolveMatch;
  readonly index_record: IndexRecord;
}

export { IndexRecord };

export const resolveResponseSchema = {
  type: 'object',
  required: ['locator', 'identifier', 'match', 'index_record'],
  properties: {
    locator:      { type: 'string', minLength: 1 },
    identifier:   { type: 'string', minLength: 1 },
    match:        { type: 'string', enum: ['exact', 'publisher'] },
    index_record: INDEX_RECORD_SCHEMA,
  },
} as const;
