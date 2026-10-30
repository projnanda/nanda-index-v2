import type { CatalogDocument, CatalogEntry, ResolveResponse } from "./nanda-types";

/**
 * Hop 2 of resolution: follow the index entry's URL to the next discovery
 * object. The URL takes three shapes, and only one of them is a registry API:
 *
 *   - a single resource (agent card, MCP server card, skill): fetch it as-is;
 *   - a static catalog document (…/ai-catalog.json): fetch it and read it;
 *   - a registry API base: ask it for /agents/<id> (or /agents to list), and
 *     fall back to the origin's /.well-known/ai-catalog.json when it has no API.
 *
 * On an "exact" match the URL is the next hop itself, so a catalog identifier
 * lists the catalog. On a "publisher" match the entry is looked up inside it.
 */

const SINGLE_RESOURCE_TYPES = new Set([
  "application/a2a-agent-card+json",
  "application/mcp-server-card+json",
  "application/agentskill+zip",
]);

export type HopShape = "entry" | "document";

export interface HopStep {
  url: string;
  /** What the URL returns: one catalog entry, or a whole catalog document. */
  shape: HopShape;
}

export interface HopPlan {
  /** "catalog": the identifier names the catalog itself; "entry": one resource. */
  kind: "entry" | "catalog";
  /** URLs to try in order; later ones are fallbacks. */
  steps: HopStep[];
}

export type RegistryHop =
  | { kind: "entry"; url: string; entry: CatalogEntry }
  | { kind: "catalog"; url: string; document: CatalogDocument };

/** Fetches a URL's JSON, throwing on network or HTTP failure. */
export type JsonFetcher = (url: string) => Promise<unknown>;

/** A URL naming a catalog document itself, not a registry API base. */
export function isCatalogDocumentUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".json");
  } catch {
    return false;
  }
}

/** The publisher's static catalog at its origin's well-known path. */
export function wellKnownCatalogUrl(url: string): string {
  return `${new URL(url).origin}/.well-known/ai-catalog.json`;
}

/** The URLs hop 2 tries for a resolution result, in order. Empty when the entry has no URL. */
export function planRegistryHop(resolved: ResolveResponse): HopPlan {
  const { url, type } = resolved.entry;
  if (!url) return { kind: "entry", steps: [] };
  if (type && SINGLE_RESOURCE_TYPES.has(type)) return { kind: "entry", steps: [{ url, shape: "entry" }] };

  const kind = resolved.match === "exact" ? "catalog" : "entry";
  if (isCatalogDocumentUrl(url)) return { kind, steps: [{ url, shape: "document" }] };

  const base = url.replace(/\/+$/, "");
  const fallback: HopStep = { url: wellKnownCatalogUrl(url), shape: "document" };
  return kind === "catalog"
    ? { kind, steps: [{ url: `${base}/agents`, shape: "document" }, fallback] }
    : { kind, steps: [{ url: `${base}/agents/${encodeURIComponent(resolved.identifier)}`, shape: "entry" }, fallback] };
}

function isCatalogDocument(body: unknown): body is CatalogDocument {
  return typeof body === "object" && body !== null && Array.isArray((body as { entries?: unknown }).entries);
}

/** The entry for `locator` in a catalog, whether it lists full URNs or bare short-names. */
export function findCatalogEntry(document: CatalogDocument, locator: string, shortName: string): CatalogEntry | undefined {
  const wanted = new Set([locator.toLowerCase(), shortName.toLowerCase()]);
  return document.entries.find(
    (entry) => typeof entry?.identifier === "string" && wanted.has(entry.identifier.toLowerCase()),
  );
}

/** Thrown when every step answered but none held the requested entry. */
export class CatalogEntryNotFound extends Error {
  constructor(readonly locator: string, readonly url: string) {
    super(`${locator} is not listed in the catalog at ${url}`);
    this.name = "CatalogEntryNotFound";
  }
}

/**
 * Runs the plan: the first step that yields what was asked for wins. When all
 * fail, the first error is rethrown, since it came from the URL the publisher
 * registered; a catalog that answered without the entry wins over that.
 */
export async function resolveRegistryHop(resolved: ResolveResponse, fetchJson: JsonFetcher): Promise<RegistryHop> {
  const plan = planRegistryHop(resolved);
  let firstError: unknown = null;
  let notListed: CatalogEntryNotFound | null = null;

  for (const step of plan.steps) {
    let body: unknown;
    try {
      body = await fetchJson(step.url);
    } catch (err) {
      firstError ??= err;
      continue;
    }
    if (step.shape === "entry") return { kind: "entry", url: step.url, entry: body as CatalogEntry };
    if (!isCatalogDocument(body)) {
      firstError ??= new Error(`${step.url} did not return an AI Catalog document`);
      continue;
    }
    if (plan.kind === "catalog") return { kind: "catalog", url: step.url, document: body };
    const entry = findCatalogEntry(body, resolved.locator, resolved.identifier);
    if (entry) return { kind: "entry", url: step.url, entry };
    notListed ??= new CatalogEntryNotFound(resolved.locator, step.url);
  }
  throw notListed ?? firstError ?? new Error("This entry has no URL to follow.");
}
