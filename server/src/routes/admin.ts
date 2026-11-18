import type { FastifyInstance } from 'fastify';
import { setModeration, setModerationByPrefix, toIndexRecord } from '../db/queries/organizations.js';
import { INDEX_RECORD_SCHEMA, MODERATION_STATES, type Moderation } from '../types/api/index-record.js';
import { apiErrorSchema } from '../types/api/common.js';
import { requireOperator } from '../services/operators.js';

/**
 * A bulk prefix must be specific enough that a slip cannot moderate the
 * whole index (e.g. "a" or "-"); "mbox-" is the shape we expect.
 */
const MIN_BULK_PREFIX_LENGTH = 3;

const MODERATION_PROPERTY = { type: 'string', enum: MODERATION_STATES } as const;

interface BulkModerationBody {
  org_id_prefix: string;
  moderation: Moderation;
}

/**
 * Index-operator routes (ADMIN_EMAILS, OAuth accounts only — see
 * services/operators.ts). Every route requires a valid JWT and the operator
 * check; anyone else gets 403.
 *
 *   POST /api/v1/admin/orgs/:org_id/moderation  — set one entry's moderation
 *   POST /api/v1/admin/orgs/moderation-bulk     — set moderation on every org_id with a prefix
 */
export async function registerAdminRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Params: { org_id: string }; Body: { moderation: Moderation } }>('/api/v1/admin/orgs/:org_id/moderation', {
    preValidation: [fastify.authenticate, requireOperator],
    schema: {
      tags: ['admin'],
      summary: 'Set an entry\'s operator moderation (none | hidden | takedown)',
      params: {
        type: 'object',
        required: ['org_id'],
        properties: { org_id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['moderation'],
        additionalProperties: false,
        properties: { moderation: MODERATION_PROPERTY },
      },
      response: {
        200: INDEX_RECORD_SCHEMA,
        403: apiErrorSchema,
        404: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const updated = await setModeration(request.params.org_id, request.body.moderation);
    if (!updated) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: `org "${request.params.org_id}" not found` });
    }
    request.log.info({ orgId: updated.orgId, moderation: updated.moderation }, 'operator set moderation');
    return reply.send(toIndexRecord(updated));
  });

  fastify.post<{ Body: BulkModerationBody }>('/api/v1/admin/orgs/moderation-bulk', {
    preValidation: [fastify.authenticate, requireOperator],
    schema: {
      tags: ['admin'],
      summary: 'Set operator moderation on every entry whose org_id starts with a prefix',
      body: {
        type: 'object',
        required: ['org_id_prefix', 'moderation'],
        additionalProperties: false,
        properties: {
          org_id_prefix: { type: 'string', minLength: MIN_BULK_PREFIX_LENGTH, maxLength: 64, pattern: '^[a-z0-9-]+$' },
          moderation: MODERATION_PROPERTY,
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['org_id_prefix', 'moderation', 'count', 'org_ids'],
          properties: {
            org_id_prefix: { type: 'string' },
            moderation:    MODERATION_PROPERTY,
            count:         { type: 'integer', minimum: 0 },
            org_ids:       { type: 'array', items: { type: 'string' } },
          },
        },
        400: apiErrorSchema,
        403: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const { org_id_prefix, moderation } = request.body;
    const orgIds = await setModerationByPrefix(org_id_prefix, moderation);
    request.log.info({ prefix: org_id_prefix, moderation, count: orgIds.length }, 'operator set bulk moderation');
    return reply.send({ org_id_prefix, moderation, count: orgIds.length, org_ids: orgIds });
  });
}
