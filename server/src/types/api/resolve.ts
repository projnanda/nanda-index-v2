import type { IndexRecord } from './index-record.js';
import { INDEX_RECORD_SCHEMA } from './index-record.js';
import type { ParsedLocator } from '../../lib/locatorParser.js';

export type { ParsedLocator };

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
    locator:      { type: 'string', minLength: 1 },
    identifier:   { type: 'string', minLength: 1 },
    index_record: INDEX_RECORD_SCHEMA,
  },
} as const;
