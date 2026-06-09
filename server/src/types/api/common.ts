export interface ApiError {
  error: string;
  detail?: string;
  endpoint?: string;
}

export const apiErrorSchema = {
  type: 'object',
  required: ['error'],
  additionalProperties: false,
  properties: {
    error:    { type: 'string' },
    detail:   { type: 'string' },
    endpoint: { type: 'string' },
  },
} as const;

export interface OrgIdParams {
  org_id: string;
}

export const orgIdParamsSchema = {
  type: 'object',
  required: ['org_id'],
  additionalProperties: false,
  properties: {
    org_id: {
      type: 'string',
      pattern: '^[a-z0-9][a-z0-9-]*[a-z0-9]$',
      minLength: 2,
      maxLength: 64,
    },
  },
} as const;
