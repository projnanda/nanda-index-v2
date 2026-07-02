import type { CatalogEntry, IndexRecord } from "@/lib/nanda-types";

/**
 * Projects our internal (snake_case, operational) IndexRecord into a canonical
 * AI Catalog **CatalogEntry** (camelCase, portable): `registry_url`→`url` (XOR
 * inline `data`), and only the fields AI Catalog defines. NANDA-internal fields
 * (org_id, status, ttl_seconds, verified flags, created_at, domain) are dropped.
 *
 * The output matches the "Catalog Entry JSON" shown on the AGNTCY/AI Catalog
 * dashboard. Pure and side-effect free.
 */
export function toCatalogEntry(record: IndexRecord): CatalogEntry {
  const entry: CatalogEntry = {
    identifier: record.identifier ?? record.org_id,
    displayName: record.display_name,
    mediaType: record.media_type ?? "application/ai-catalog+json",
  };

  // Exactly one of url / data (url takes precedence when both are present).
  if (record.registry_url) entry.url = record.registry_url;
  else if (record.data) entry.data = record.data;

  if (record.version) entry.version = record.version;
  if (record.description) entry.description = record.description;
  if (record.tags && record.tags.length > 0) entry.tags = record.tags;
  if (record.publisher) entry.publisher = record.publisher;
  if (record.trust_manifest) entry.trustManifest = record.trust_manifest;
  if (record.updated_at) entry.updatedAt = record.updated_at;
  if (record.metadata && Object.keys(record.metadata).length > 0) {
    entry.metadata = record.metadata;
  }

  return entry;
}
