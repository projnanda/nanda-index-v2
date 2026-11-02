import type { FastifyInstance } from 'fastify';
import { buildConfig } from '../config/index.js';
import { findByOrgId, findProvenByDomain } from '../db/queries/organizations.js';
import { apiErrorSchema } from '../types/api/common.js';
import type { JwtPayload } from '../plugins/jwt.js';
import { isReservedOrgId } from '../lib/reservedOrgIds.js';
import { isAbandonedClaim } from '../services/claims.js';
import { isOperator } from '../services/operators.js';

interface AvailabilityQuerystring {
  org_id?: string;
  domain?: string;
}

/**
 * GET /api/v1/availability — lets the registration form report a taken org_id
 * or domain on step 1, instead of only after the final submit.
 *
 * Mirrors the checks POST /api/v1/orgs makes before inserting:
 *   - a domain is taken only when a *proven* org holds it — unproven claims
 *     reserve nothing (findProvenByDomain, as registration's findConflict);
 *   - an org_id is taken while any org holds it, unless that holder is an
 *     abandoned unproven claim (isAbandonedClaim, as findSlugConflict);
 *   - a reserved org_id is unavailable, except to an operator.
 * Read-only on purpose: unlike registration it never releases an abandoned
 * claim's slug — it only reports that registering would.
 *
 * Signed-in and throttled with the auth routes' limits. It reveals no more than
 * a registration attempt's 409 does, but should not be a cheap way to enumerate
 * pending claims. The budget is per user, not per IP: behind the reverse proxy
 * every request shares one IP, so an IP key would be a single site-wide budget.
 * Running the limiter at preHandler puts it after authenticate, so request.user
 * is set and unauthenticated calls spend no one's budget.
 *
 * Lives outside /api/v1/orgs/ so it cannot shadow an org whose org_id is
 * "availability".
 */
export async function registerAvailabilityRoute(fastify: FastifyInstance): Promise<void> {
  const config = buildConfig();

  fastify.get<{ Querystring: AvailabilityQuerystring }>('/api/v1/availability', {
    preValidation: [fastify.authenticate],
    config: {
      rateLimit: {
        max: config.auth.rateLimitMax,
        timeWindow: config.auth.rateLimitWindow,
        hook: 'preHandler',
        keyGenerator: (request) => (request.user as JwtPayload).userId,
      },
    },
    schema: {
      tags: ['orgs'],
      summary: 'Check whether an org_id and/or domain is still free to register',
      querystring: {
        type: 'object',
        anyOf: [{ required: ['org_id'] }, { required: ['domain'] }],
        properties: {
          org_id: { type: 'string', minLength: 1, maxLength: 64 },
          domain: { type: 'string', minLength: 1, maxLength: 255 },
        },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          properties: {
            org_id_available: { type: 'boolean' },
            domain_available: { type: 'boolean' },
          },
        },
        400: apiErrorSchema,
        401: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const { org_id: orgId, domain } = request.query;
    const { userId } = request.user as JwtPayload;
    const [orgIdAvailable, domainHolder] = await Promise.all([
      orgId ? isOrgIdAvailable(orgId, userId) : null,
      domain ? findProvenByDomain(domain) : null,
    ]);
    return reply.send({
      ...(orgId ? { org_id_available: orgIdAvailable } : {}),
      ...(domain ? { domain_available: domainHolder === null } : {}),
    });
  });
}

/** Whether POST /api/v1/orgs would accept this org_id from this user. */
async function isOrgIdAvailable(orgId: string, userId: string): Promise<boolean> {
  if (isReservedOrgId(orgId) && !(await isOperator(userId))) return false;
  const holder = await findByOrgId(orgId);
  return holder === null || isAbandonedClaim(holder);
}
