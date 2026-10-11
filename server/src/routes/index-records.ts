import type { FastifyInstance } from 'fastify';
import { findAllActive, findByOrgId, markEmailVerifiedByToken, toIndexEntry, toIndexRecord } from '../db/queries/organizations.js';
import { INDEX_RECORD_SCHEMA } from '../types/api/index-record.js';
import { INDEX_ENTRY_SCHEMA } from '../types/api/index-entry.js';
import { apiErrorSchema } from '../types/api/common.js';

/**
 * Public read-only routes for the NANDA Index.
 *
 * GET /api/v1/index           — list all active entries, in the paper's AI Catalog entry shape
 * GET /api/v1/index/:org_id   — get a single entry (same shape), 404 on miss
 * GET /api/v1/verify-email    — mark org contact email verified (also activates
 *                                personal/no-domain orgs; domain-based orgs
 *                                still need domain verification separately)
 */
export async function registerIndexRecordRoutes(fastify: FastifyInstance): Promise<void> {
  // List all active index records
  fastify.get('/api/v1/index', {
    schema: {
      tags: ['index'],
      summary: 'List all active index entries (AI Catalog entry shape)',
      response: {
        200: { type: 'array', items: INDEX_ENTRY_SCHEMA },
      },
    },
  }, async (_request, reply) => {
    const orgs = await findAllActive();
    return reply.send(orgs.map(toIndexEntry));
  });

  // Get a single index record by org_id
  fastify.get<{ Params: { org_id: string } }>('/api/v1/index/:org_id', {
    schema: {
      tags: ['index'],
      summary: 'Get a single index entry (AI Catalog entry shape)',
      params: {
        type: 'object',
        required: ['org_id'],
        properties: { org_id: { type: 'string' } },
      },
      response: {
        200: INDEX_ENTRY_SCHEMA,
        404: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const org = await findByOrgId(request.params.org_id);
    if (!org) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: `org "${request.params.org_id}" not found` });
    }
    return reply.send(toIndexEntry(org));
  });

  // Email verification — marks contact email verified. Activates personal
  // (no-domain) orgs outright; domain-based orgs still need domain verification.
  fastify.get<{ Querystring: { token?: string } }>('/api/v1/verify-email', {
    schema: {
      tags: ['auth'],
      summary: 'Verify org contact email (activates personal orgs; others still need domain verification)',
      querystring: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string', minLength: 1 } },
      },
      response: {
        200: INDEX_RECORD_SCHEMA,
        400: apiErrorSchema,
        404: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const { token } = request.query;
    if (!token) {
      return reply.code(400).send({ error: 'BAD_REQUEST', detail: 'token query parameter is required' });
    }
    const org = await markEmailVerifiedByToken(token);
    if (!org) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: 'verification token not found or already used' });
    }
    return reply.send(toIndexRecord(org));
  });
}
