/**
 * GET /health response shapes.
 * 200 → HealthOk. 503 → ApiError (from common.ts).
 */

export interface HealthOk {
  status: 'ok';
  db: 'ok';
}

export const healthOkSchema = {
  type: 'object',
  required: ['status', 'db'],
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['ok'] },
    db: { type: 'string', enum: ['ok'] },
  },
} as const;
