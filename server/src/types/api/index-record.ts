/** Wire shape returned by the NANDA Index for a registered organization. */
export interface IndexRecord {
  org_id: string;
  display_name: string;
  domain: string;
  registry_url: string;
  ttl_seconds: number;
  status: 'pending' | 'active' | 'suspended';
  email_verified: boolean;
  created_at: string;
  updated_at: string;
}

export const INDEX_RECORD_SCHEMA = {
  type: 'object',
  required: ['org_id', 'display_name', 'domain', 'registry_url', 'ttl_seconds', 'status', 'email_verified', 'created_at', 'updated_at'],
  properties: {
    org_id:         { type: 'string' },
    display_name:   { type: 'string' },
    domain:         { type: 'string' },
    registry_url:   { type: 'string' },
    ttl_seconds:    { type: 'number' },
    status:         { type: 'string', enum: ['pending', 'active', 'suspended'] },
    email_verified: { type: 'boolean' },
    created_at:     { type: 'string' },
    updated_at:     { type: 'string' },
  },
} as const;
