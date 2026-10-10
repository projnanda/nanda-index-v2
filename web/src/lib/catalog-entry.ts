import type { IndexCatalogEntry, IndexRecord } from "@/lib/nanda-types";

/**
 * Projects our internal (snake_case, operational) IndexRecord into the AI
 * Catalog entry shape the switchboard paper uses (§6): `media_type`→`type`,
 * `registry_url`→`url` (XOR inline `data`), routing hints under `extensions`.
 * NANDA-internal fields (org_id, status, ttl_seconds, verified flags,
 * created_at, domain) are dropped. Pure and side-effect free.
 */
export function toCatalogEntry(record: IndexRecord): IndexCatalogEntry {
  const hasExtensions = Object.values(record.extensions ?? {}).some((ns) => Object.keys(ns).length > 0);
  return {
    identifier: record.identifier,
    displayName: record.display_name,
    type: record.media_type ?? "application/ai-catalog+json",
    // Exactly one of url / data (url takes precedence when both are present).
    ...(record.registry_url ? { url: record.registry_url } : record.data ? { data: record.data } : {}),
    ...(record.version ? { version: record.version } : {}),
    ...(record.description ? { description: record.description } : {}),
    ...(record.tags && record.tags.length > 0 ? { tags: record.tags } : {}),
    ...(record.publisher ? { publisher: record.publisher } : {}),
    ...(record.trust_manifest ? { trustManifest: record.trust_manifest } : {}),
    ...(record.updated_at ? { updatedAt: record.updated_at } : {}),
    ...(hasExtensions ? { extensions: record.extensions } : {}),
  };
}
