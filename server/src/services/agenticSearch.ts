import { rankOrganizationsForQuery, type RankedOrganization } from '../db/queries/organizations.js';
import { fanOutAgentSearch, type FanoutCandidate } from './registryFanout.js';
import { toArdType } from '../lib/ardMapping.js';
import { buildAirUrn } from '../lib/airUrn.js';
import type { UrlGuard } from '../lib/outboundUrl.js';
import type { AgentCandidate, AgenticSearchResponse, FinderReferral } from '../types/api/agentic-search.js';

export interface AgenticSearchOptions {
  topOrgs?: number;
  perOrgLimit?: number;
  limit?: number;
  /** SSRF check for registry fan-out (see registryFanout.ts). */
  urlGuard?: UrlGuard;
}

function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\W+/).filter(Boolean);
}

/** Fraction of query terms present in `text` (case-insensitive substring match). */
function termOverlapScore(text: string, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 0;
  const lower = text.toLowerCase();
  const matched = queryTerms.filter((term) => lower.includes(term)).length;
  return matched / queryTerms.length;
}

/**
 * Registries may return bare agent ids ("flights"). The entry was found via a
 * verified domain, so qualify it to the paper's urn:air:<domain>:agent:<id>
 * form; already-qualified URNs, and ids that can't form a valid URN, pass
 * through unchanged.
 */
function qualifyIdentifier(raw: string, org: RankedOrganization): string {
  if (raw.toLowerCase().startsWith('urn:') || !org.domain) return raw;
  try {
    return buildAirUrn(org.domain, ['agent'], raw);
  } catch {
    return raw;
  }
}

/** An ARD finder's search endpoint, by the ARD layout <base>/search (cf. /api/ard → /api/ard/search). */
function toFinderReferral(org: RankedOrganization): FinderReferral {
  return {
    identifier: org.identifier,
    display_name: org.displayName,
    search_url: `${org.registryUrl!.replace(/\/+$/, '')}/search`,
  };
}

function toAgentCandidate(
  { org, entry, basis }: FanoutCandidate,
  queryTerms: string[],
  maxOrgRank: number,
): AgentCandidate {
  const orgScore = maxOrgRank > 0 ? org.rank / maxOrgRank : 0;
  const text = `${entry.displayName} ${entry.description ?? ''} ${(entry.tags ?? []).join(' ')}`;
  const overlapScore = termOverlapScore(text, queryTerms);

  return {
    identifier: qualifyIdentifier(entry.identifier, org),
    display_name: entry.displayName,
    type: toArdType(entry.mediaType),
    url: entry.url,
    description: entry.description ?? null,
    tags: entry.tags ?? [],
    publisher: org.publisher ?? undefined,
    trust_manifest: org.trustManifest ?? undefined,
    provenance: {
      org_id: org.orgId,
      registry_url: org.registryUrl!,
      basis,
    },
    score: orgScore * 0.6 + overlapScore * 0.4,
  };
}

/**
 * Core agentic-search pipeline: rank candidate orgs locally (Postgres FTS),
 * fan out live to expand each into agent-level candidates (branching by
 * media_type — see registryFanout.ts), then score and merge into one flat,
 * ranked list. Backs both /api/v1/agentic-search (NANDA-native) and
 * /api/ard/search (ARD-compliant) — those two only differ in wire casing.
 */
export async function agenticSearch(
  query: string,
  opts: AgenticSearchOptions = {},
): Promise<AgenticSearchResponse> {
  const topOrgs = opts.topOrgs ?? 10;
  const perOrgLimit = opts.perOrgLimit ?? 10;
  const limit = opts.limit ?? 20;
  const start = Date.now();

  const rankedOrgs = await rankOrganizationsForQuery(query, topOrgs);
  const maxOrgRank = rankedOrgs.reduce((max, o) => Math.max(max, o.rank), 0);

  const { candidates: fanoutCandidates, unreachable, finders } = await fanOutAgentSearch(
    rankedOrgs,
    query,
    { perOrgLimit, urlGuard: opts.urlGuard },
  );

  const queryTerms = tokenize(query);
  const scored = fanoutCandidates
    .map((c) => toAgentCandidate(c, queryTerms, maxOrgRank))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    query,
    count: scored.length,
    candidates: scored,
    resolved: scored[0] ?? null,
    referrals: finders.map(toFinderReferral),
    orgs_queried: rankedOrgs.length,
    orgs_unreachable: unreachable,
    took_ms: Date.now() - start,
  };
}
