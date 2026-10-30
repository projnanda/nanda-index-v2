import type { RankedOrganization } from '../db/queries/organizations.js';
import { ARD_FINDER_MEDIA_TYPE, ENTERPRISE_MEDIA_TYPE, POINTER_ONLY_MEDIA_TYPE } from '../lib/mediaTypes.js';
import { publicUrlGuard, type UrlGuard } from '../lib/outboundUrl.js';
import { readCappedJson, sanitizeRemoteEntry } from './remoteEntry.js';

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
  /** Untrusted until each passes sanitizeRemoteEntry. */
  entries: unknown[];
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
  /** Matching ARD finders (ai-registry entries): the requester should query
   *  these directly, so they are referred to rather than expanded. */
  finders: RankedOrganization[];
}

export interface FanoutOptions {
  concurrency?: number;
  timeoutMs?: number;
  perOrgLimit?: number;
  /** SSRF check run on every registry URL before it is fetched. Defaults to
   *  allowing only publicly routable hosts. */
  urlGuard?: UrlGuard;
}

function isRemoteCatalogDocument(body: unknown): body is RemoteCatalogDocument {
  return (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { entries?: unknown }).entries)
  );
}

/** A registry_url naming a catalog document itself (…/ai-catalog.json), not a registry API base. */
export function isCatalogDocumentUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.json');
  } catch {
    return false;
  }
}

/** The publisher's static catalog at its origin's well-known path. */
export function wellKnownCatalogUrl(url: string): string {
  return `${new URL(url).origin}/.well-known/ai-catalog.json`;
}

/** Query words too common to tell one catalog entry from another. */
const STOP_WORDS = new Set(['a', 'an', 'and', 'agent', 'agents', 'find', 'for', 'help', 'i', 'me', 'my', 'need', 'the', 'to', 'want', 'with']);

/**
 * Filters a static catalog's entries the way a registry's /agents/search
 * would: an entry matches when its name, identifier, description or tags
 * contain a query word (a trailing plural "s" is ignored), most matches first.
 */
export function searchCatalogEntries(entries: RemoteCatalogEntry[], query: string): RemoteCatalogEntry[] {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));
  if (terms.length === 0) return [];
  return entries
    .map((entry) => {
      const haystack = [entry.displayName, entry.identifier, entry.description ?? '', ...(entry.tags ?? [])]
        .join(' ').toLowerCase();
      return { entry, score: terms.filter((t) => haystack.includes(t)).length };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => entry);
}

/**
 * GETs one catalog-shaped response ({ entries: [...] }) and keeps only
 * well-formed entries anchored to this org's own domain. Never throws:
 * network errors, non-2xx responses and malformed JSON resolve to `null`.
 */
async function fetchCatalogEntries(
  url: string,
  org: RankedOrganization,
  signal: AbortSignal,
  urlGuard: UrlGuard,
): Promise<RemoteCatalogEntry[] | null> {
  try {
    // registry_url is registrant-controlled: refuse internal hosts, connect
    // only to the addresses the guard checked (no DNS rebinding), and refuse
    // redirects so a public host can't bounce us to an internal one.
    const guardedFetch = await urlGuard(url);
    const res = await guardedFetch(url, { signal, redirect: 'error' });
    if (!res.ok) return null;

    // The response is the registrant's to shape: read a bounded amount.
    const body = await readCappedJson(res);
    if (!isRemoteCatalogDocument(body)) return null;

    return body.entries
      .map((raw) => sanitizeRemoteEntry(raw, org.domain))
      .filter((entry): entry is RemoteCatalogEntry => entry !== null);
  } catch {
    return null;
  }
}

/**
 * Fetches up to `perOrgLimit` agent candidates from one enterprise org.
 * registry_url takes two shapes: a static catalog document (…/ai-catalog.json),
 * searched locally; or a registry API base, asked via /agents/search, falling
 * back to the origin's /.well-known/ai-catalog.json when the publisher serves
 * no search API. `null` only when no shape answers, so one flaky registry
 * can't fail the whole fan-out. One timeout covers every attempt.
 */
async function fetchAgentSearch(
  org: RankedOrganization,
  query: string,
  timeoutMs: number,
  perOrgLimit: number,
  urlGuard: UrlGuard,
): Promise<RemoteCatalogEntry[] | null> {
  const registryUrl = org.registryUrl;
  if (!registryUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fromDocument = async (url: string) => {
    const entries = await fetchCatalogEntries(url, org, controller.signal, urlGuard);
    return entries && searchCatalogEntries(entries, query);
  };
  try {
    if (isCatalogDocumentUrl(registryUrl)) {
      return (await fromDocument(registryUrl))?.slice(0, perOrgLimit) ?? null;
    }
    const searchUrl = `${registryUrl.replace(/\/+$/, '')}/agents/search?q=${encodeURIComponent(query)}`;
    const viaApi = await fetchCatalogEntries(searchUrl, org, controller.signal, urlGuard);
    if (viaApi) return viaApi.slice(0, perOrgLimit);
    if (controller.signal.aborted) return null;
    return (await fromDocument(wellKnownCatalogUrl(registryUrl)))?.slice(0, perOrgLimit) ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Synthesizes a single candidate directly from the org's own record — used
 * for every media_type except enterprise, where registry_url already IS the
 * one agent (SMB/personal cards, DNS SVCB pointers) rather than a registry with
 * many agents to search underneath it. */
function synthesizeSingleAgentCandidate(org: RankedOrganization): FanoutCandidate {
  return {
    org,
    basis: 'single_agent_org',
    entry: {
      identifier: org.identifier,
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
 * fanned out to live via GET <registry_url>/agents/search; pointer-only
 * registries (POINTER_ONLY_MEDIA_TYPE, e.g. ANS) are skipped entirely — the
 * index points at them but never resolves into them; ARD finders
 * (ai-registry, e.g. an AGNTCY ADS node) are returned as finders to refer
 * the requester to (paper §7.3–7.4: NandaIndex finds the right finder, the
 * finder does the search); every other type (SMB/personal A2A cards, DNS
 * SVCB pointers) already represents exactly one agent, so it's emitted
 * as-is with no HTTP call.
 */
export async function fanOutAgentSearch(
  orgs: RankedOrganization[],
  query: string,
  opts: FanoutOptions = {},
): Promise<FanoutResult> {
  const concurrency = opts.concurrency ?? 5;
  const timeoutMs = opts.timeoutMs ?? 2500;
  const perOrgLimit = opts.perOrgLimit ?? 10;
  const urlGuard = opts.urlGuard ?? publicUrlGuard;

  const candidates: FanoutCandidate[] = [];
  const unreachable: string[] = [];
  const finders: RankedOrganization[] = [];

  const tasks = orgs.map((org) => async () => {
    if (org.mediaType === POINTER_ONLY_MEDIA_TYPE) {
      // Pointer-only registry (e.g. ANS): the index never resolves into it.
      // No fan-out, no single-agent synthesis — it contributes nothing here.
      return;
    }
    if (org.mediaType === ARD_FINDER_MEDIA_TYPE) {
      finders.push(org);
      return;
    }
    if (org.mediaType !== ENTERPRISE_MEDIA_TYPE) {
      candidates.push(synthesizeSingleAgentCandidate(org));
      return;
    }

    const entries = await fetchAgentSearch(org, query, timeoutMs, perOrgLimit, urlGuard);
    if (entries === null) {
      unreachable.push(org.orgId);
      return;
    }
    for (const entry of entries) {
      candidates.push({ org, entry, basis: 'agent_search' });
    }
  });

  await runWithConcurrency(tasks, concurrency);
  return { candidates, unreachable, finders };
}
