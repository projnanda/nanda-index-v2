import type { IndexCatalogEntry } from "@/lib/nanda-types";
import { nandaField } from "@/lib/air";

// An entry is described by two independent facets, so a personal entry can
// still be found by what it publishes (a personal MCP server is both):
//   - Owner: who registered it. Decided by the server-assigned resolutionRole,
//     then by the entry's own tags, then by protocol (a catalog is Enterprise).
//   - Protocol: what it publishes. Decided by media type alone.
// How the entry is reached (DNS SVCB, catalog, hosted or inline resource) is a
// third, display-only attribute: see discoveryMethodOf.

export type Owner = "enterprise" | "smb" | "personal";
export type Protocol = "a2a" | "mcp" | "skill" | "catalog";

export const OWNERS: readonly Owner[] = ["enterprise", "smb", "personal"];
export const PROTOCOLS: readonly Protocol[] = ["a2a", "mcp", "skill", "catalog"];

export const OWNER_LABELS: Record<Owner, string> = {
  enterprise: "Enterprise",
  smb: "SMB",
  personal: "Personal",
};

export const PROTOCOL_LABELS: Record<Protocol, string> = {
  a2a: "A2A",
  mcp: "MCP",
  skill: "Agent Skill",
  catalog: "Catalog",
};

// The DNS SVCB role is deliberately absent: any domain owner can publish that
// way, so it describes how an entry is discovered, not who owns it.
const ROLE_OWNER: Record<string, Owner> = {
  "personal-agent-card": "personal",
  "smb-agent-card": "smb",
  "nested-ai-catalog": "enterprise",
};

// Checked in order, so the most specific claim wins when tags disagree.
const TAG_OWNER: readonly (readonly [tag: string, owner: Owner])[] = [
  ["personal-agent", "personal"],
  ["email-identity", "personal"],
  ["smb", "smb"],
  ["enterprise", "enterprise"],
];

const MEDIA_TYPE_PROTOCOL: Record<string, Protocol> = {
  "application/a2a-agent-card+json": "a2a",
  "application/mcp-server-card+json": "mcp",
  "application/agentskill+zip": "skill",
  "application/ai-catalog+json": "catalog",
  "application/ai-registry+json": "catalog",
};

const DNS_SVCB_ROLE = "dns-svcb-pointer";

/** What the entry publishes, from its media type; null when unrecognised. */
export function protocolOf(record: IndexCatalogEntry): Protocol | null {
  const mediaType = (record.type ?? "").split(";", 1)[0].trim().toLowerCase();
  return MEDIA_TYPE_PROTOCOL[mediaType] ?? null;
}

/** Who registered the entry; null when nothing says. */
export function ownerOf(record: IndexCatalogEntry): Owner | null {
  const role = nandaField(record, "resolutionRole");
  const byRole = role ? ROLE_OWNER[role] : undefined;
  if (byRole) return byRole;

  const tags = new Set((record.tags ?? []).map((tag) => tag.toLowerCase()));
  const byTag = TAG_OWNER.find(([tag]) => tags.has(tag));
  if (byTag) return byTag[1];

  return protocolOf(record) === "catalog" ? "enterprise" : null;
}

/** How a client reaches the entry's resource. */
export function discoveryMethodOf(record: IndexCatalogEntry): string {
  if (nandaField(record, "resolutionRole") === DNS_SVCB_ROLE) return "DNS SVCB";
  if (protocolOf(record) === "catalog") return "Catalog";
  if (record.url) return "Hosted resource";
  return record.data ? "Inline resource" : "Custom discovery";
}

/** True when `value` passes a facet group: nothing selected, or it is one of the selected. */
export function inSelection<T extends string>(value: T | null, selected: ReadonlySet<T>): boolean {
  return selected.size === 0 || (value !== null && selected.has(value));
}

/** Per-value totals for one facet, plus the entries that have no value. */
export interface FacetTally<T extends string> {
  counts: ReadonlyMap<T, number>;
  unspecified: number;
  total: number;
}

/** Tally one facet's values; a null value counts as unspecified. */
export function tallyFacet<T extends string>(values: readonly (T | null)[]): FacetTally<T> {
  const counts = values.reduce<ReadonlyMap<T, number>>(
    (acc, value) => (value ? new Map(acc).set(value, (acc.get(value) ?? 0) + 1) : acc),
    new Map(),
  );
  const specified = [...counts.values()].reduce((sum, n) => sum + n, 0);
  return { counts, unspecified: values.length - specified, total: values.length };
}
