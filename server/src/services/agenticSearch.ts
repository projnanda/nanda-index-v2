import { rankOrganizationsForQuery } from '../db/queries/organizations.js';
import { fanOutAgentSearch, type FanoutCandidate } from './registryFanout.js';
import { toArdType } from '../lib/ardMapping.js';
import type { AgentCandidate, AgenticSearchResponse } from '../types/api/agentic-search.js';

export interface AgenticSearchOptions {
  topOrgs?: number;
  perOrgLimit?: number;
  limit?: number;
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

function toAgentCandidate(
  { org, entry, basis }: FanoutCandidate,
  queryTerms: string[],
  maxOrgRank: number,
): AgentCandidate {
  const orgScore = maxOrgRank > 0 ? org.rank / maxOrgRank : 0;
  const text = `${entry.displayName} ${entry.description ?? ''} ${(entry.tags ?? []).join(' ')}`;
  const overlapScore = termOverlapScore(text, queryTerms);

  return {
    identifier: entry.identifier,
    display_name: entry.displayName,
    type: toArdType(entry.mediaType),
    url: entry.url,
    description: entry.description ?? null,
    tags: entry.tags ?? [],
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

  const { candidates: fanoutCandidates, unreachable } = await fanOutAgentSearch(
    rankedOrgs,
    query,
    { perOrgLimit },
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
    orgs_queried: rankedOrgs.length,
    orgs_unreachable: unreachable,
    took_ms: Date.now() - start,
  };
}
