import { findByDomain, findByOrgId, toIndexRecord } from '../db/queries/organizations.js';
import type { ParsedLocator, ResolveResponse } from '../types/api/resolve.js';

/**
 * Structured error thrown by resolveAgent — route maps code to HTTP status.
 */
export class ResolutionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'not_found'    // 404
      | 'bad_request'  // 400
  ) {
    super(message);
    this.name = 'ResolutionError';
  }
}

/**
 * Resolves an agent locator to an IndexRecord via NANDA Index DB lookup.
 * Returns the IndexRecord and the parsed identifier so the caller can fetch
 * the AgentRecord directly: GET <index_record.registry_url>/agents/<identifier>
 *
 * @param locator - parsed locator from parseLocator()
 * @returns ResolveResponse with identifier and index_record
 * @throws ResolutionError
 */
export async function resolveAgent(locator: ParsedLocator): Promise<ResolveResponse> {
  const { urn, identifier, domain } = locator;

  // Lookup org by domain in NANDA Index DB
  let org = await findByDomain(domain);
  if (!org) {
    // Fallback: try matching by org_id slug (e.g. "nasiko" derived from "nasiko.com")
    const slug = domain.replace(/\.[^.]+$/, '');
    org = await findByOrgId(slug);
  }

  if (!org || org.status !== 'active') {
    throw new ResolutionError(
      `domain "${domain}" not found in NANDA Index or is not active`,
      'not_found',
    );
  }

  return {
    locator: urn,
    identifier,
    index_record: toIndexRecord(org),
  };
}
