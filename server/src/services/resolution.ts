import { findByDomain, findByIdentifier, toIndexRecord, type Organization } from '../db/queries/organizations.js';
import type { ParsedAirUrn } from '../lib/airUrn.js';
import { CATALOG_MEDIA_TYPES } from '../lib/mediaTypes.js';
import type { ResolveMatch, ResolveResponse } from '../types/api/resolve.js';

export class ResolutionError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_found' | 'bad_request',
  ) {
    super(message);
    this.name = 'ResolutionError';
  }
}

/** Resolvable only while active and, for domain entries, with domain ownership proven. */
function isLive(org: Organization | null): org is Organization {
  return org?.status === 'active' && (org.domain === null || org.domainVerified);
}

export interface ResolvedEntry {
  readonly org: Organization;
  readonly match: ResolveMatch;
}

/**
 * Maps a urn:air: identifier to the next discovery object (paper §5.4):
 * the entry registered under exactly that identifier, or — when the
 * publisher fronts its resources with an AI Catalog / registry — that
 * catalog entry, which the requester then queries for the resource. An agent
 * card is never returned for a different identifier. Returns null on a miss.
 */
export async function findResolvedEntry(parsed: ParsedAirUrn): Promise<ResolvedEntry | null> {
  const exact = await findByIdentifier(parsed.urn);
  if (isLive(exact)) return { org: exact, match: 'exact' };

  const publisher = await findByDomain(parsed.publisherDomain);
  if (isLive(publisher) && (CATALOG_MEDIA_TYPES as readonly string[]).includes(publisher.mediaType)) {
    return { org: publisher, match: 'publisher' };
  }
  return null;
}

export async function resolveIdentifier(parsed: ParsedAirUrn): Promise<ResolveResponse> {
  const resolved = await findResolvedEntry(parsed);
  if (!resolved) {
    throw new ResolutionError(`"${parsed.urn}" not found in NANDA Index or is not active`, 'not_found');
  }

  return {
    locator: parsed.urn,
    identifier: parsed.shortName,
    match: resolved.match,
    index_record: toIndexRecord(resolved.org),
  };
}
