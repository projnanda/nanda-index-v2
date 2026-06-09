import type { IndexRecord } from './index-record.js';
import { INDEX_RECORD_SCHEMA } from './index-record.js';

/** GET /api/v1/search?q=keyword — response envelope. */
export interface SearchResponse {
  query: string;
  count: number;
  results: IndexRecord[];
}

export const searchQuerySchema = {
  type: 'object',
  required: ['q'],
  additionalProperties: false,
  properties: {
    q: { type: 'string', minLength: 1, maxLength: 128 },
  },
} as const;

export const searchResponseSchema = {
  type: 'object',
  required: ['query', 'count', 'results'],
  additionalProperties: false,
  properties: {
    query:   { type: 'string', minLength: 1, maxLength: 128 },
    count:   { type: 'integer', minimum: 0 },
    results: { type: 'array', items: INDEX_RECORD_SCHEMA },
  },
} as const;
