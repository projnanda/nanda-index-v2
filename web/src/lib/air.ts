import type { HostingPath, IndexRecord } from "@/lib/nanda-types";

/**
 * Client-side mirror of the server's urn:air: conventions
 * (server/src/lib/airUrn.ts + entryProfile.ts) — used for previews and
 * display only. The server derives and validates the authoritative values.
 */

export const NANDA_EXTENSION = "org.projectnanda";

/** Third-party card host that anchors identifiers for domain-less individuals. */
export const PERSONAL_CARD_HOST = "host39.org";

/** "john@hotmail.com" → "john-hotmail-com" (the paper's personal short-name form). */
export function emailToSlug(email: string): string {
  return email.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * The identifier the server will assign for a registration:
 *   registry       → urn:air:<domain>:catalog:root
 *   smb / dns-svcb → urn:air:<domain>:agent:<shortName>
 *   personal       → urn:air:host39.org:personal:<email-slug>
 */
export function previewIdentifier(
  path: HostingPath,
  opts: { domain?: string; email?: string; shortName?: string },
): string {
  if (path === "personal") {
    return `urn:air:${PERSONAL_CARD_HOST}:personal:${emailToSlug(opts.email ?? "") || "<email>"}`;
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

/** The record's `org.projectnanda` extension fields (empty when absent). */
export function nandaExtension(record: Pick<IndexRecord, "extensions">): Record<string, unknown> {
  return record.extensions?.[NANDA_EXTENSION] ?? {};
}

/** A string-valued field from the record's `org.projectnanda` extension. */
export function nandaField(record: Pick<IndexRecord, "extensions">, key: string): string | undefined {
  const value = nandaExtension(record)[key];
  return typeof value === "string" ? value : undefined;
}
