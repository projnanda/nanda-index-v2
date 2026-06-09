export type OrgStatus = "active" | "pending" | "suspended";

export interface IndexRecord {
  org_id: string;
  display_name: string;
  domain: string;
  registry_url: string;
  ttl_seconds: number;
  status: OrgStatus;
  email_verified: boolean;
  created_at: string;
  updated_at: string;
}

/** AI Catalog CatalogEntry (application/ai-catalog+json). */
export interface CatalogEntry {
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

/** AI Catalog top-level document. */
export interface CatalogDocument {
  specVersion: string;
  entries: CatalogEntry[];
}

export interface ResolveResponse {
  locator: string;
  identifier: string;
  index_record: IndexRecord;
}

export interface User {
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  orgs: OrgMembership[];
}

export interface OrgMembership {
  org_id: string;
  display_name: string;
  role: string;
  status: OrgStatus;
  email_verified: boolean;
}

export interface SearchResponse {
  query: string;
  count: number;
  results: IndexRecord[];
}

export interface CreateOrgPayload {
  org_id: string;
  display_name: string;
  domain: string;
  contact_email: string;
  registry_url: string;
  ttl_seconds?: number;
}

export interface UpdateOrgPayload {
  display_name?: string;
  domain?: string;
  registry_url?: string;
  ttl_seconds?: number;
}
