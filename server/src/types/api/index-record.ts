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

/** Wire shape returned by the NANDA Index for a registered organization. */
export interface IndexRecord {
  org_id: string;
  display_name: string;
  domain: string | null;
  registry_url: string | null;
  ttl_seconds: number;
  status: 'pending' | 'active' | 'suspended';
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

export const INDEX_RECORD_SCHEMA = {
  type: 'object',
  required: ['org_id', 'display_name', 'ttl_seconds', 'status', 'email_verified', 'domain_verified', 'created_at', 'updated_at'],
  properties: {
    org_id:          { type: 'string' },
    display_name:    { type: 'string' },
    domain:          { type: ['string', 'null'] },
    registry_url:    { type: ['string', 'null'] },
    ttl_seconds:     { type: 'number' },
    status:          { type: 'string', enum: ['pending', 'active', 'suspended'] },
    email_verified:  { type: 'boolean' },
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
    metadata: { type: 'object', additionalProperties: true },
    data:     { type: 'object', additionalProperties: true },
    version:  { type: 'string' },
    trust_manifest: {
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
    },
  },
} as const;
