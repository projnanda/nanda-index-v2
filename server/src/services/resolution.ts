import { findByDomain, findByOrgId, findByIdentifier, toIndexRecord } from '../db/queries/organizations.js';
import type { ParsedLocator, ResolveResponse } from '../types/api/resolve.js';

export class ResolutionError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_found' | 'bad_request',
  ) {
    super(message);
    this.name = 'ResolutionError';
  }
}

export async function resolveAgent(locator: ParsedLocator): Promise<ResolveResponse> {
  const { urn, type, domain, email, identifier } = locator;

  let org;

  if (type === 'email') {
    // Email-identity: look up by the full stored identifier URN
    org = await findByIdentifier(urn);
  } else {
    // Domain-based: lookup by domain, then slug fallback, then identifier fallback
    org = await findByDomain(domain!);
    if (!org) {
      const slug = domain!.replace(/\.[^.]+$/, '');
      org = await findByOrgId(slug);
    }
    if (!org) {
      org = await findByIdentifier(urn);
    }
  }

  if (!org || org.status !== 'active') {
    throw new ResolutionError(
      `"${urn}" not found in NANDA Index or is not active`,
      'not_found',
    );
  }

  return {
    locator: urn,
    identifier,
    index_record: toIndexRecord(org),
  };
}
