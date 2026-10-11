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

/** AI Catalog `extensions`: reverse-DNS namespace → that namespace's fields. */
export type CatalogExtensions = Record<string, Record<string, unknown>>;

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
  /** Domain-anchored ARD identifier: urn:air:<publisher-FQDN>:<namespace...>:<short-name>. */
  identifier: string;
  media_type?: string;
  description?: string | null;
  tags?: string[];
  publisher?: PublisherBlock;
  /** AI Catalog extension fields, keyed by reverse-DNS namespace (e.g. "org.projectnanda"). */
  extensions: CatalogExtensions;
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

/**
 * An index entry in the switchboard paper's AI Catalog entry shape (§6), as
 * served by GET /api/v1/index: `type` + `url` XOR `data`, routing hints under
 * `extensions`.
 */
export interface IndexCatalogEntry {
  identifier: string;
  displayName: string;
  type: string;
  url?: string;
  data?: Record<string, unknown>;
  version?: string;
  description?: string;
  tags: string[];
  publisher?: PublisherBlock;
  trustManifest?: TrustManifest;
  updatedAt: string;
  /** Routing hints, plus read-only operational state (orgId, status,
   *  ttlSeconds, emailVerified, domainVerified, createdAt, domain,
   *  representativeQueries) under "org.projectnanda". */
  extensions: CatalogExtensions;
}

/** AI Catalog top-level document. */
export interface CatalogDocument {
  specVersion: string;
  entries: CatalogEntry[];
}

/**
 * exact     — an entry is registered under exactly this identifier.
 * publisher — the publisher's catalog/registry entry; look `identifier` up inside it.
 */
export type ResolveMatch = "exact" | "publisher";

export interface ResolveResponse {
  /** The normalised urn:air: identifier that was resolved. */
  locator: string;
  /** The locator's short-name — the key to look up inside a catalog on a publisher match. */
  identifier: string;
  match: ResolveMatch;
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
  /** Publisher of the index entry the candidate was found through. */
  publisher?: PublisherBlock;
  trust_manifest?: TrustManifest;
  provenance: {
    org_id: string;
    registry_url: string;
    basis: "agent_search" | "single_agent_org" | "federated";
  };
  score: number;
}

/** A matching ARD finder the requester should query directly. */
export interface FinderReferral {
  identifier: string;
  display_name: string;
  search_url: string;
}

export interface AgenticSearchResponse {
  query: string;
  count: number;
  candidates: AgentCandidate[];
  resolved: AgentCandidate | null;
  referrals: FinderReferral[];
  orgs_queried: number;
  orgs_unreachable: string[];
  took_ms: number;
}

export type HostingPath = "registry" | "dns-svcb" | "smb" | "personal";

export interface CreateOrgPayload {
  org_id: string;
  display_name: string;
  hosting_path?: HostingPath;
  domain?: string | null;
  contact_email: string;
  registry_url: string;
  ttl_seconds?: number;
  /** Optional override; must be anchored to `domain`. Personal identifiers are always derived. */
  identifier?: string;
  media_type?: string;
  description?: string;
  tags?: string[];
  /** Only the display name is client-controlled; the server sets the publisher identifier. */
  publisher?: { displayName: string };
  extensions?: CatalogExtensions;
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
  publisher?: { displayName: string };
  extensions?: CatalogExtensions;
  entry_data?: Record<string, unknown>;
  version?: string;
  /** undefined = leave unchanged; null = clear the stored manifest. */
  trust_manifest?: TrustManifest | null;
}
