import type { CatalogExtensions, HostingPath, IndexCatalogEntry, OrgStatus } from "@/lib/nanda-types";

/**
 * Client-side mirror of the server's urn:air: conventions
 * (server/src/lib/airUrn.ts + entryProfile.ts) — used for previews and
 * display only. The server derives and validates the authoritative values.
 */

export const NANDA_EXTENSION = "org.projectnanda";

/** Third-party card host that anchors identifiers for domain-less individuals. */
export const PERSONAL_CARD_HOST = "host39.org";

const SEGMENT_LITERAL_RE = /^[a-z0-9._~!$&'()*+,;=@-]$/;

/** Mirrors the server's emailSegment(): the lowercased email itself, with
 *  only URN-unsafe characters percent-encoded ("john@hotmail.com" stays as-is). */
export function emailSegment(email: string): string {
  const encoder = new TextEncoder();
  return [...email.trim().toLowerCase()]
    .map((ch) => SEGMENT_LITERAL_RE.test(ch)
      ? ch
      : [...encoder.encode(ch)].map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`).join(""))
    .join("");
}

/**
 * The identifier the server will assign for a registration:
 *   registry       → urn:air:<domain>:catalog:root
 *   smb / dns-svcb → urn:air:<domain>:agent:<shortName>
 *   personal       → urn:air:host39.org:personal:<email>
 */
export function previewIdentifier(
  path: HostingPath,
  opts: { domain?: string; email?: string; shortName?: string },
): string {
  if (path === "personal") {
    return `urn:air:${PERSONAL_CARD_HOST}:personal:${emailSegment(opts.email ?? "") || "<email>"}`;
  }
  const domain = opts.domain?.trim().toLowerCase() || "<domain>";
  return path === "registry"
    ? `urn:air:${domain}:catalog:root`
    : `urn:air:${domain}:agent:${opts.shortName || "<agent>"}`;
}

/** True when `identifier` is a urn:air: identifier anchored to `domain`. */
export function isAnchoredTo(identifier: string, domain: string): boolean {
  const trimmed = identifier.trim();
  const prefix = `urn:air:${domain.trim().toLowerCase()}:`;
  if (!trimmed.toLowerCase().startsWith(prefix)) return false;
  return /^[A-Za-z0-9._~-]+(:[A-Za-z0-9._~-]+)+$/.test(trimmed.slice(prefix.length));
}

interface HasExtensions {
  extensions?: CatalogExtensions;
}

/** The record's `org.projectnanda` extension fields (empty when absent). */
export function nandaExtension(record: HasExtensions): Record<string, unknown> {
  return record.extensions?.[NANDA_EXTENSION] ?? {};
}

/** A string-valued field from the record's `org.projectnanda` extension. */
export function nandaField(record: HasExtensions, key: string): string | undefined {
  const value = nandaExtension(record)[key];
  return typeof value === "string" ? value : undefined;
}

/** NANDA operational state the server adds to an index entry's extension on read. */
export interface EntryOps {
  orgId: string;
  status: OrgStatus;
  ttlSeconds: number;
  emailVerified: boolean;
  domainVerified: boolean;
  createdAt: string;
  /** The verified domain; null for personal (no-domain) entries. */
  domain: string | null;
  representativeQueries: string[];
}

export function entryOps(entry: IndexCatalogEntry): EntryOps {
  const ext = nandaExtension(entry);
  return {
    orgId: typeof ext.orgId === "string" ? ext.orgId : "",
    status: (typeof ext.status === "string" ? ext.status : "pending") as OrgStatus,
    ttlSeconds: typeof ext.ttlSeconds === "number" ? ext.ttlSeconds : 0,
    emailVerified: ext.emailVerified === true,
    domainVerified: ext.domainVerified === true,
    createdAt: typeof ext.createdAt === "string" ? ext.createdAt : "",
    domain: typeof ext.domain === "string" ? ext.domain : null,
    representativeQueries: Array.isArray(ext.representativeQueries)
      ? ext.representativeQueries.filter((q): q is string => typeof q === "string")
      : [],
  };
}
