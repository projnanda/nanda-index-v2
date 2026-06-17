export interface PublisherBlock {
  identifier: string;
  displayName: string;
  identityType?: string;
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

export const INDEX_RECORD_SCHEMA = {
  type: 'object',
  required: ['org_id', 'display_name', 'ttl_seconds', 'status', 'email_verified', 'created_at', 'updated_at'],
  properties: {
    org_id:         { type: 'string' },
    display_name:   { type: 'string' },
    domain:         { type: ['string', 'null'] },
    registry_url:   { type: ['string', 'null'] },
    ttl_seconds:    { type: 'number' },
    status:         { type: 'string', enum: ['pending', 'active', 'suspended'] },
    email_verified: { type: 'boolean' },
    created_at:     { type: 'string' },
    updated_at:     { type: 'string' },
    identifier:     { type: 'string' },
    media_type:     { type: 'string' },
    description:    { type: ['string', 'null'] },
    tags:           { type: 'array', items: { type: 'string' } },
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
  },
} as const;
