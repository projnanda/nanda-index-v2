import { searchOrganizations, toIndexRecord } from '../db/queries/organizations.js';
import type { SearchResponse } from '../types/api/search.js';
import { parseAirUrn } from '../lib/airUrn.js';
import { findResolvedEntry } from './resolution.js';

/**
 * Smart search across the NANDA Index.
 *
 * - A urn:air: identifier resolves exactly as GET /api/v1/resolve does
 *   (exact entry, else the publisher's catalog).
 * - Anything else runs a keyword search across org_id, domain,
 *   display_name and identifier.
 */
export async function searchOrgs(rawQuery: string): Promise<SearchResponse> {
  const query = rawQuery.trim();

  if (query.toLowerCase().startsWith('urn:air:')) {
    try {
      const resolved = await findResolvedEntry(parseAirUrn(query));
      const results = resolved ? [toIndexRecord(resolved.org)] : [];
      return { query, count: results.length, results };
    } catch {
      // Malformed identifier — fall through to keyword search
    }
  }

  const rows = await searchOrganizations(query);
  return {
    query,
    count: rows.length,
    results: rows.map(toIndexRecord),
  };
}
