import type { FastifyInstance } from 'fastify';
import {
  countListedEntries, findByOrgId, listListedEntries, markEmailVerifiedByToken, toIndexEntry, toIndexRecord,
} from '../db/queries/organizations.js';
import { INDEX_RECORD_SCHEMA } from '../types/api/index-record.js';
import { INDEX_ENTRY_SCHEMA } from '../types/api/index-entry.js';
import { apiErrorSchema } from '../types/api/common.js';
import { isLive } from '../services/resolution.js';
import { buildConfig } from '../config/index.js';
import { publicReadRateLimit } from '../plugins/rateLimit.js';
import { cacheFor } from '../lib/ttlCache.js';

/** Page size when ?limit is omitted, and the most one request may ask for. */
const DEFAULT_INDEX_PAGE_SIZE = 100;
const MAX_INDEX_PAGE_SIZE = 500;

interface IndexListQuerystring {
  limit?: number;
  offset?: number;
}

/**
 * Public read-only routes for the NANDA Index.
 *
 * GET /api/v1/index           — list listed entries (active, not moderated), paged
 *                               by ?limit/&offset, in the paper's AI Catalog entry shape
 * GET /api/v1/index/:org_id   — get a single live entry (same shape); 404 on
 *                                miss, for pending, suspended or unproven orgs,
 *                                and for taken-down ones
 * GET /api/v1/verify-email    — forward an emailed link to the web confirmation page
 * POST /api/v1/verify-email   — mark org contact email verified (also activates
 *                                personal/no-domain orgs; domain-based orgs
 *                                still need domain verification separately)
 */
export async function registerIndexRecordRoutes(fastify: FastifyInstance): Promise<void> {
  const config = buildConfig();
  // Counting every listed entry costs the same on every page, so the total is
  // reused for INDEX_STATS_CACHE_SECONDS; the page itself is always live.
  const listedTotal = cacheFor(config.indexStatsCacheSeconds * 1000, countListedEntries);

  // List index entries. Paged so one request cannot pull the whole index; the
  // body stays a bare array (existing clients keep working) and the total
  // rides in X-Total-Count (cached, so it may lag new entries briefly).
  fastify.get<{ Querystring: IndexListQuerystring }>('/api/v1/index', {
    config: publicReadRateLimit(),
    schema: {
      tags: ['index'],
      summary: 'List index entries (AI Catalog entry shape), paged; total in X-Total-Count',
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit:  { type: 'integer', minimum: 1, maximum: MAX_INDEX_PAGE_SIZE, default: DEFAULT_INDEX_PAGE_SIZE },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
      response: {
        200: { type: 'array', items: INDEX_ENTRY_SCHEMA },
        400: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const [rows, total] = await Promise.all([
      listListedEntries(request.query.limit ?? DEFAULT_INDEX_PAGE_SIZE, request.query.offset ?? 0),
      listedTotal(),
    ]);
    return reply.header('X-Total-Count', String(total)).send(rows.map(toIndexEntry));
  });

  // Get a single live index record by org_id. A 'hidden' entry is still
  // readable here (hiding only affects listings); a taken-down one is not.
  fastify.get<{ Params: { org_id: string } }>('/api/v1/index/:org_id', {
    config: publicReadRateLimit(),
    schema: {
      tags: ['index'],
      summary: 'Get a single live index entry (AI Catalog entry shape)',
      description: 'Only live entries (active, proven, not taken down) are public: pending, suspended, unproven and taken-down entries return 404, the same as an unknown org_id.',
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
    // Same visibility rule as resolve (isLive): pending, suspended, unproven
    // and taken-down entries are not public (and a personal one carries the registrant's email). Owners see
    // their own entry via the authenticated GET /api/v1/orgs/:org_id.
    const org = await findByOrgId(request.params.org_id);
    if (!isLive(org)) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: `org "${request.params.org_id}" not found` });
    }
    return reply.send(toIndexEntry(org));
  });

  // Links sent before verification moved to the web app point here. Opening a
  // link must not verify (mail scanners open it first and used to consume the
  // single-use token), so this only forwards to the page that asks the
  // recipient to confirm.
  fastify.get<{ Querystring: { token?: string } }>('/api/v1/verify-email', {
    schema: {
      tags: ['auth'],
      summary: 'Forward an emailed verification link to the web confirmation page',
      querystring: {
        type: 'object',
        properties: { token: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const token = encodeURIComponent(request.query.token ?? '');
    return reply.redirect(`${buildConfig().frontendUrl}/verify-email?token=${token}`, 302);
  });

  // Email verification — marks contact email verified. Activates personal
  // (no-domain) orgs outright; domain-based orgs still need domain verification.
  fastify.post<{ Body: { token: string } }>('/api/v1/verify-email', {
    config: {
      rateLimit: { max: config.auth.rateLimitMax, timeWindow: config.auth.rateLimitWindow },
    },
    schema: {
      tags: ['auth'],
      summary: 'Verify org contact email (activates personal orgs; others still need domain verification)',
      body: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string', minLength: 1, maxLength: 128 } },
      },
      response: {
        200: INDEX_RECORD_SCHEMA,
        400: apiErrorSchema,
        404: apiErrorSchema,
        409: apiErrorSchema,
        429: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const { token } = request.body;
    let org;
    try {
      org = await markEmailVerifiedByToken(token);
    } catch (err) {
      // Another registration proved this email first — first proof wins.
      if ((err as { code?: unknown }).code === '23505') {
        return reply.code(409).send({ error: 'CONFLICT', detail: 'this identity was verified by another registration' });
      }
      throw err;
    }
    if (!org) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: 'verification token not found or already used' });
    }
    fastify.analytics.capture('entry_email_verified', { has_domain: org.domain !== null });
    return reply.send(toIndexRecord(org));
  });
}
