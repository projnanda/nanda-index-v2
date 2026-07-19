import type { FederationConfig } from '../config/index.js';
import type { AgentCandidate } from '../types/api/agentic-search.js';

export interface FederationReferral {
  displayName: string;
  searchUrl: string;
}

export interface FederationResult {
  candidates: AgentCandidate[];
  referrals: FederationReferral[];
  federated: boolean;
}

interface UpstreamArdResult {
  identifier: string;
  displayName: string;
  type: string;
  url: string;
  description?: string | null;
  tags?: string[];
  trustManifest?: unknown;
}

function isUpstreamSearchResponse(body: unknown): body is { results: UpstreamArdResult[] } {
  return (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { results?: unknown }).results)
  );
}

/**
 * Optionally augments local ARD search results with an upstream registry
 * (ora.ai by default), mirroring ARD's own federation.modes concept:
 *  - 'none': no-op — the default, zero risk.
 *  - 'referrals': attach a pointer to the upstream without fetching; the
 *    caller can query it themselves.
 *  - 'auto': fetch the upstream only when local results are thin, dedupe by
 *    identifier, and merge — tagging federated results' basis accordingly.
 * Scoped to the /api/ard/* surface only (see agenticSearch.ts) — the
 * NANDA-native /api/v1/agentic-search endpoint never federates, so it stays
 * free of external-dependency surprises.
 */
export async function maybeFederateOut(
  query: string,
  local: AgentCandidate[],
  cfg: FederationConfig,
): Promise<FederationResult> {
  if (cfg.mode === 'none') {
    return { candidates: local, referrals: [], federated: false };
  }

  const referral: FederationReferral = {
    displayName: cfg.upstreamName,
    searchUrl: cfg.upstreamUrl,
  };

  if (cfg.mode === 'referrals') {
    return { candidates: local, referrals: [referral], federated: false };
  }

  // mode === 'auto'
  if (local.length >= cfg.thinResultThreshold) {
    return { candidates: local, referrals: [], federated: false };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(cfg.upstreamUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: { text: query } }),
      signal: controller.signal,
    });
    if (!res.ok) return { candidates: local, referrals: [referral], federated: false };

    const body: unknown = await res.json();
    if (!isUpstreamSearchResponse(body)) {
      return { candidates: local, referrals: [referral], federated: false };
    }

    const seen = new Set(local.map((c) => c.identifier));
    const federatedCandidates: AgentCandidate[] = body.results
      .filter((r) => !seen.has(r.identifier))
      .map((r) => ({
        identifier: r.identifier,
        display_name: r.displayName,
        type: r.type,
        url: r.url,
        description: r.description ?? null,
        tags: r.tags ?? [],
        provenance: {
          org_id: cfg.upstreamName,
          registry_url: cfg.upstreamUrl,
          basis: 'federated' as const,
        },
        score: 0,
      }));

    return {
      candidates: [...local, ...federatedCandidates],
      referrals: [],
      federated: federatedCandidates.length > 0,
    };
  } catch {
    return { candidates: local, referrals: [referral], federated: false };
  } finally {
    clearTimeout(timer);
  }
}
