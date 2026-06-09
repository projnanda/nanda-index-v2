import { searchOrganizations, findByDomain, findByOrgId, toIndexRecord } from '../db/queries/organizations.js';
import type { SearchResponse } from '../types/api/search.js';

/**
 * Matches a URN agent locator: urn:<nid>:<domain>:<identifier>
 * e.g. urn:ai:moonbakery.com:order
 */
const URN_RE = /^urn:[a-z0-9][a-z0-9-]{0,30}:([^:]+):[^:]+$/i;

/**
 * Smart search across the NANDA Index.
 *
 * - If the query is a valid URN locator (urn:<nid>:<domain>:<identifier>),
 *   extract the domain component and do a direct domain lookup. This lets
 *   callers paste a full agent URN and get back the owning org's IndexRecord.
 *
 * - Otherwise, run a case-insensitive keyword search across org_id, domain,
 *   and display_name (LIKE pattern, active orgs only, max 50 results).
 *
 * @param rawQuery - search string (trimmed, ≥ 2 chars)
 */
export async function searchOrgs(rawQuery: string): Promise<SearchResponse> {
  const query = rawQuery.trim();

  // URN fast-path: extract domain and do a direct lookup
  const urnMatch = URN_RE.exec(query);
  if (urnMatch) {
    const domain = urnMatch[1]!;
    let org = await findByDomain(domain);

    // Fallback: strip TLD and try matching as org_id slug (e.g. "nasiko" from "nasiko.com")
    if (!org) {
      const slug = domain.replace(/\.[^.]+$/, '');
      org = await findByOrgId(slug);
    }

    const results = org ? [toIndexRecord(org)] : [];
    return { query, count: results.length, results };
  }

  // Keyword search path
  const rows = await searchOrganizations(query);
  return {
    query,
    count: rows.length,
    results: rows.map(toIndexRecord),
  };
}
