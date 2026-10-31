import type { CardValidation } from '../../services/cardValidation.js';
export interface PublisherBlock {
  identifier: string;
  displayName: string;
  identityType?: string;
}

// ── AI Catalog Trust Manifest (dir catalog/v1/models.proto:166-253) ──────────
// Structured, verifiable trust metadata carried alongside a CatalogEntry.

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

/** Operator moderation states (migration 017): see db/migrations/017_moderation_and_listing.sql. */
export const MODERATION_STATES = ['none', 'hidden', 'takedown'] as const;
export type Moderation = (typeof MODERATION_STATES)[number];

/** Wire shape returned by the NANDA Index for a registered organization. */
export interface IndexRecord {
  org_id: string;
  display_name: string;
  domain: string | null;
  registry_url: string | null;
  ttl_seconds: number;
  status: 'pending' | 'active' | 'suspended';
  email_verified: boolean;
  email_verified_at?: string | null;
  domain_verified_at?: string | null;
  card_validation?: CardValidation | null;
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
  extensions: Record<string, Record<string, unknown>>;
  data?: Record<string, unknown>;
  version?: string;
  trust_manifest?: TrustManifest;
  /** Always false when trust_manifest is present: the manifest is
   *  self-asserted by the registrant and not verified by the index. */
  trust_manifest_verified?: false;
  /** Operator moderation; lets the owner's dashboard explain a hidden entry. */
  moderation?: Moderation;
  /** LLM-generated natural-language task phrasings folded into search
   *  ranking — e.g. "help me send a transactional email" for an email API.
   *  Omitted when enrichment isn't configured or hasn't run for this org. */
  representative_queries?: string[];
}

/**
 * JSON schema for a TrustManifest. Shared by the IndexRecord response schema
 * and the org create/update body schemas so the wire shapes cannot drift.
 */
export const TRUST_MANIFEST_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    identity:         { type: 'string' },
    identityType:     { type: 'string' },
    trustSchema:      { type: 'object', additionalProperties: true },
    attestations:     { type: 'array', items: { type: 'object', additionalProperties: true } },
    provenance:       { type: 'array', items: { type: 'object', additionalProperties: true } },
    privacyPolicyUrl: { type: 'string' },
    termsOfServiceUrl:{ type: 'string' },
    signature:        { type: 'string' },
    metadata:         { type: 'object', additionalProperties: true },
  },
} as const;

/** AI Catalog `extensions`: each reverse-DNS namespace maps to an object of fields. */
export const EXTENSIONS_SCHEMA = {
  type: 'object',
  additionalProperties: { type: 'object', additionalProperties: true },
} as const;

export const INDEX_RECORD_SCHEMA = {
  type: 'object',
  required: ['org_id', 'display_name', 'identifier', 'extensions', 'ttl_seconds', 'status', 'email_verified', 'domain_verified', 'created_at', 'updated_at'],
  properties: {
    org_id:          { type: 'string' },
    display_name:    { type: 'string' },
    domain:          { type: ['string', 'null'] },
    registry_url:    { type: ['string', 'null'] },
    ttl_seconds:     { type: 'number' },
    status:          { type: 'string', enum: ['pending', 'active', 'suspended'] },
    email_verified:  { type: 'boolean' },
    email_verified_at: { type: ['string', 'null'] },
    domain_verified_at: { type: ['string', 'null'] },
    card_validation: { type: ['object', 'null'], additionalProperties: true },
    domain_verified: { type: 'boolean' },
    created_at:      { type: 'string' },
    updated_at:      { type: 'string' },
    identifier:      { type: 'string' },
    media_type:      { type: 'string' },
    description:     { type: ['string', 'null'] },
    tags:            { type: 'array', items: { type: 'string' } },
    publisher: {
      type: 'object',
      properties: {
        identifier:   { type: 'string' },
        displayName:  { type: 'string' },
        identityType: { type: 'string' },
      },
    },
    extensions: EXTENSIONS_SCHEMA,
    data:       { type: 'object', additionalProperties: true },
    version:  { type: 'string' },
    trust_manifest: TRUST_MANIFEST_SCHEMA,
    trust_manifest_verified: { type: 'boolean' },
    moderation: { type: 'string', enum: MODERATION_STATES },
    representative_queries: { type: 'array', items: { type: 'string' } },
  },
} as const;
