export type OrgStatus = "active" | "pending" | "suspended";

export interface PublisherBlock {
  identifier: string;
  displayName: string;
  identityType?: string;
}

export interface IndexRecord {
  org_id: string;
  display_name: string;
  domain: string | null;
  registry_url: string | null;
  ttl_seconds: number;
  status: OrgStatus;
  email_verified: boolean;
  created_at: string;
  updated_at: string;

  // AI Catalog fields
  identifier?: string;
  media_type?: string;
  description?: string | null;
  tags?: string[];
  publisher?: PublisherBlock;
  metadata?: Record<string, unknown>;
  data?: Record<string, unknown>;
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

export type HostingPath = "registry" | "dns-aid" | "smb" | "personal";

export interface CreateOrgPayload {
  org_id: string;
  display_name: string;
  hosting_path?: HostingPath;
  domain?: string | null;
  contact_email: string;
  registry_url?: string | null;
  ttl_seconds?: number;
  identifier?: string;
  media_type?: string;
  description?: string;
  tags?: string[];
  publisher?: PublisherBlock;
  catalog_metadata?: Record<string, unknown>;
  entry_data?: Record<string, unknown>;
}

export interface UpdateOrgPayload {
  display_name?: string;
  domain?: string;
  registry_url?: string | null;
  ttl_seconds?: number;
  description?: string;
  tags?: string[];
  publisher?: PublisherBlock;
  catalog_metadata?: Record<string, unknown>;
  entry_data?: Record<string, unknown>;
}
