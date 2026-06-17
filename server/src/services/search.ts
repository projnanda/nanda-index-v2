import { searchOrganizations, findByDomain, findByOrgId, findByIdentifier, toIndexRecord } from '../db/queries/organizations.js';
import type { SearchResponse } from '../types/api/search.js';
import { parseLocator } from '../lib/locatorParser.js';

/**
 * Smart search across the NANDA Index.
 *
 * - If the query is a valid URN, parse it and do a direct lookup by type.
 * - Otherwise run a keyword search across org_id, domain, display_name, identifier.
 */
export async function searchOrgs(rawQuery: string): Promise<SearchResponse> {
  const query = rawQuery.trim();

  // Try to parse as a URN first
  if (query.toLowerCase().startsWith('urn:')) {
    try {
      const parsed = parseLocator(query);

      let org;
      if (parsed.type === 'email') {
        org = await findByIdentifier(parsed.urn);
      } else {
        org = await findByDomain(parsed.domain!);
        if (!org) {
          const slug = parsed.domain!.replace(/\.[^.]+$/, '');
          org = await findByOrgId(slug);
        }
        if (!org) {
          org = await findByIdentifier(parsed.urn);
        }
      }

      const results = org ? [toIndexRecord(org)] : [];
      return { query, count: results.length, results };
    } catch {
      // Not a valid URN — fall through to keyword search
    }
  }

  // Keyword search path
  const rows = await searchOrganizations(query);
  return {
    query,
    count: rows.length,
    results: rows.map(toIndexRecord),
  };
}
