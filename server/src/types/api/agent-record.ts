/** Wire shape returned by a Registry Server for one agent. */
export interface AgentRecord {
  agent_id: string;
  display_name: string;
  description: string | null;
  card_url: string;
  tags: string[];
  ttl_seconds: number;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export const AGENT_RECORD_SCHEMA = {
  type: 'object',
  required: ['agent_id', 'display_name', 'card_url', 'tags', 'ttl_seconds', 'status', 'created_at', 'updated_at'],
  properties: {
    agent_id:     { type: 'string' },
    display_name: { type: 'string' },
    description:  { type: ['string', 'null'] },
    card_url:     { type: 'string' },
    tags:         { type: 'array', items: { type: 'string' } },
    ttl_seconds:  { type: 'number' },
    status:       { type: 'string', enum: ['active', 'inactive'] },
    created_at:   { type: 'string' },
    updated_at:   { type: 'string' },
  },
} as const;
