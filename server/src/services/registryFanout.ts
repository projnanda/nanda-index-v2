import type { RankedOrganization } from '../db/queries/organizations.js';

/** Wire shape returned by a nanda-registry instance's CatalogEntry (camelCase). */
export interface RemoteCatalogEntry {
  identifier: string;
  displayName: string;
  mediaType: string;
  url: string;
  description?: string | null;
  tags?: string[];
  version?: string | null;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

interface RemoteCatalogDocument {
  specVersion: string;
  entries: RemoteCatalogEntry[];
}

export type FanoutBasis = 'agent_search' | 'single_agent_org';

export interface FanoutCandidate {
  org: RankedOrganization;
  entry: RemoteCatalogEntry;
  basis: FanoutBasis;
}

export interface FanoutResult {
  candidates: FanoutCandidate[];
  unreachable: string[];
}

export interface FanoutOptions {
  concurrency?: number;
  timeoutMs?: number;
  perOrgLimit?: number;
}

const ENTERPRISE_MEDIA_TYPE = 'application/ai-catalog+json';

function isRemoteCatalogDocument(body: unknown): body is RemoteCatalogDocument {
  return (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { entries?: unknown }).entries)
  );
}

/**
 * Fetches up to `perOrgLimit` agent candidates from one enterprise org's
 * registry_url (a nanda-registry instance). Never throws — network errors,
 * timeouts, non-2xx responses, and malformed JSON all resolve to `null` so
 * one flaky registry can't fail the whole fan-out.
 */
async function fetchAgentSearch(
  org: RankedOrganization,
  query: string,
  timeoutMs: number,
  perOrgLimit: number,
): Promise<RemoteCatalogEntry[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${org.registryUrl}/agents/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;

    const body: unknown = await res.json();
    if (!isRemoteCatalogDocument(body)) return null;

    return body.entries.slice(0, perOrgLimit);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Synthesizes a single candidate directly from the org's own record — used
 * for every media_type except enterprise, where registry_url already IS the
 * one agent (SMB/personal cards, DNS-AID entries) rather than a registry with
 * many agents to search underneath it. */
function synthesizeSingleAgentCandidate(org: RankedOrganization): FanoutCandidate {
  return {
    org,
    basis: 'single_agent_org',
    entry: {
      identifier: org.identifier ?? org.orgId,
      displayName: org.displayName,
      mediaType: org.mediaType,
      url: org.registryUrl!,
      description: org.description,
      tags: org.tags,
      version: org.version ?? undefined,
      updatedAt: org.updatedAt.toISOString(),
    },
  };
}

/** Runs `tasks` with at most `concurrency` in flight at once. */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]!();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

/**
 * Expands ranked candidate orgs into agent-level candidates, branching by
 * media_type: enterprise orgs (backed by a nanda-registry instance) are
 * fanned out to live via GET <registry_url>/agents/search; every other type
 * (SMB/personal A2A cards, DNS-AID) has no registry to search underneath —
 * the org's own record already represents exactly one agent, so it's
 * emitted as-is with no HTTP call.
 */
export async function fanOutAgentSearch(
  orgs: RankedOrganization[],
  query: string,
  opts: FanoutOptions = {},
): Promise<FanoutResult> {
  const concurrency = opts.concurrency ?? 5;
  const timeoutMs = opts.timeoutMs ?? 2500;
  const perOrgLimit = opts.perOrgLimit ?? 10;

  const candidates: FanoutCandidate[] = [];
  const unreachable: string[] = [];

  const tasks = orgs.map((org) => async () => {
    if (org.mediaType !== ENTERPRISE_MEDIA_TYPE) {
      candidates.push(synthesizeSingleAgentCandidate(org));
      return;
    }

    const entries = await fetchAgentSearch(org, query, timeoutMs, perOrgLimit);
    if (entries === null) {
      unreachable.push(org.orgId);
      return;
    }
    for (const entry of entries) {
      candidates.push({ org, entry, basis: 'agent_search' });
    }
  });

  await runWithConcurrency(tasks, concurrency);
  return { candidates, unreachable };
}
