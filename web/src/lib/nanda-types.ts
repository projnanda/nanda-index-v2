export type OrgStatus = "active" | "pending" | "suspended";

export interface PublisherBlock {
  identifier: string;
  displayName: string;
  identityType?: string;
}

// ── AI Catalog Trust Manifest (dir catalog/v1/models.proto) ──────────────────
export interface TrustSchema {
  identifier: string;
  version: string;
  governanceUri?: string;
  verificationMethods?: string[];
}

export interface Attestation {
  type: string;
  uri: string;
  mediaType: string;
  digest?: string;
  size?: string | number;
  description?: string;
}

export interface ProvenanceLink {
  relation: string;
  sourceId: string;
  sourceDigest?: string;
  registryUri?: string;
  statementUri?: string;
  signatureRef?: string;
}

export interface TrustManifest {
  identity: string;
  identityType?: string;
  trustSchema?: TrustSchema;
  attestations?: Attestation[];
  provenance?: ProvenanceLink[];
  privacyPolicyUrl?: string;
  termsOfServiceUrl?: string;
  signature?: string;
  metadata?: Record<string, unknown>;
}

export interface IndexRecord {
  org_id: string;
  display_name: string;
  domain: string | null;
  registry_url: string | null;
  ttl_seconds: number;
  status: OrgStatus;
  email_verified: boolean;
  domain_verified: boolean;
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
  version?: string;
  trust_manifest?: TrustManifest;
}

/** DNS TXT challenge issued to prove ownership of an org's domain. */
export interface DomainChallenge {
  domain: string;
  record_name: string;
  record_type: string;
  record_value: string;
  expires_at: string;
}

/** AI Catalog CatalogEntry (agent-card.github.io/ai-catalog). `url` XOR `data`. */
export interface CatalogEntry {
  identifier: string;
  displayName: string;
  mediaType: string;
  url?: string;
  data?: Record<string, unknown>;
  version?: string | null;
  description?: string | null;
  tags?: string[];
  publisher?: PublisherBlock;
  trustManifest?: TrustManifest;
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
  domain_verified: boolean;
}

export interface SearchResponse {
  query: string;
  count: number;
  results: IndexRecord[];
}

/** One ranked candidate agent returned by GET /api/v1/agentic-search. */
export interface AgentCandidate {
  identifier: string;
  display_name: string;
  type: string;
  url: string;
  description: string | null;
  tags: string[];
  trust_manifest?: TrustManifest;
  provenance: {
    org_id: string;
    registry_url: string;
    basis: "agent_search" | "single_agent_org" | "federated";
  };
  score: number;
}

export interface AgenticSearchResponse {
  query: string;
  count: number;
  candidates: AgentCandidate[];
  resolved: AgentCandidate | null;
  orgs_queried: number;
  orgs_unreachable: string[];
  took_ms: number;
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
  version?: string;
  trust_manifest?: TrustManifest;
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
  version?: string;
  /** undefined = leave unchanged; null = clear the stored manifest. */
  trust_manifest?: TrustManifest | null;
}
