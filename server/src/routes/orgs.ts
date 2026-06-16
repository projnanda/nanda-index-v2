import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { findByOrgId, insertOrganization, updateOrganization, suspendOrganization, reactivateOrganization, deleteOrganization, toIndexRecord } from '../db/queries/organizations.js';
import { insertMembership, checkMembership } from '../db/queries/orgMemberships.js';
import { sendVerificationEmail } from '../services/email.js';
import { INDEX_RECORD_SCHEMA } from '../types/api/index-record.js';
import { apiErrorSchema } from '../types/api/common.js';
import type { JwtPayload } from '../plugins/jwt.js';

interface CreateOrgBody {
  org_id: string;
  display_name: string;
  domain: string;
  contact_email: string;
  registry_url: string;
  ttl_seconds?: number;
}

interface UpdateOrgBody {
  display_name?: string;
  domain?: string;
  registry_url?: string;
  ttl_seconds?: number;
}

/**
 * preHandler factory enforcing the caller's role on an :org_id route.
 *
 *   'member' — any member (admin or member) may proceed (read access)
 *   'admin'  — only admins may proceed (mutations: update/suspend/reactivate/delete)
 *
 * On failure it responds 403 and short-circuits the route. `checkMembership`
 * returns the full membership row, so the role comes from the same lookup that
 * confirms membership — no extra query.
 */
function requireOrgRole(level: 'member' | 'admin') {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const { userId } = request.user as JwtPayload;
    const { org_id } = request.params as { org_id: string };

    const membership = await checkMembership(userId, org_id);
    if (!membership) {
      reply.code(403).send({ error: 'FORBIDDEN', detail: 'you are not a member of this organization' });
      return;
    }
    if (level === 'admin' && membership.role !== 'admin') {
      reply.code(403).send({ error: 'FORBIDDEN', detail: 'admin role required to manage this organization' });
      return;
    }
  };
}

/**
 * Protected org management routes. All routes require a valid JWT; the
 * :org_id routes additionally enforce a membership role via requireOrgRole.
 *
 *   POST   /api/v1/orgs                    — create an org (caller becomes admin; sends verification email)
 *   GET    /api/v1/orgs/:org_id            — read own org           (member)
 *   PUT    /api/v1/orgs/:org_id            — update index record    (admin)
 *   DELETE /api/v1/orgs/:org_id/suspend    — suspend org            (admin)
 *   POST   /api/v1/orgs/:org_id/reactivate — reactivate suspended   (admin)
 *   DELETE /api/v1/orgs/:org_id            — permanently delete org (admin)
 */
export async function registerOrgRoutes(fastify: FastifyInstance): Promise<void> {
  // Create a new organization
  fastify.post<{ Body: CreateOrgBody }>('/api/v1/orgs', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['orgs'],
      summary: 'Register a new organization (creates index record)',
      body: {
        type: 'object',
        required: ['org_id', 'display_name', 'domain', 'contact_email', 'registry_url'],
        properties: {
          org_id:        { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*[a-z0-9]$', minLength: 2, maxLength: 64 },
          display_name:  { type: 'string', minLength: 1, maxLength: 255 },
          domain:        { type: 'string', minLength: 3, maxLength: 255 },
          contact_email: { type: 'string', format: 'email' },
          registry_url:  { type: 'string', pattern: '^https?://', maxLength: 512 },
          ttl_seconds:   { type: 'integer', minimum: 3600, maximum: 604800 },
        },
      },
      response: {
        201: INDEX_RECORD_SCHEMA,
        409: apiErrorSchema,
        400: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const body = request.body;

    // Check for duplicate org_id
    const existing = await findByOrgId(body.org_id);
    if (existing) {
      return reply.code(409).send({ error: 'CONFLICT', detail: `org_id "${body.org_id}" is already taken` });
    }

    const verifyToken = randomBytes(32).toString('hex');
    const verifyTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const org = await insertOrganization({
      orgId:                body.org_id,
      displayName:          body.display_name,
      domain:               body.domain,
      contactEmail:         body.contact_email,
      registryUrl:          body.registry_url,
      verifyToken,
      verifyTokenExpiresAt,
      ttlSeconds:           body.ttl_seconds,
    });

    await insertMembership(user.userId, org.orgId, 'admin');
    await sendVerificationEmail(body.contact_email, verifyToken, body.org_id);

    return reply.code(201).send(toIndexRecord(org));
  });

  // Get own org (must be member)
  fastify.get<{ Params: { org_id: string } }>('/api/v1/orgs/:org_id', {
    preHandler: [fastify.authenticate, requireOrgRole('member')],
    schema: {
      tags: ['orgs'],
      summary: 'Get your organization',
      params: {
        type: 'object',
        required: ['org_id'],
        properties: { org_id: { type: 'string' } },
      },
      response: {
        200: INDEX_RECORD_SCHEMA,
        403: apiErrorSchema,
        404: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const org = await findByOrgId(request.params.org_id);
    if (!org) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: `org "${request.params.org_id}" not found` });
    }

    return reply.send(toIndexRecord(org));
  });

  // Update own org's index record
  fastify.put<{ Params: { org_id: string }; Body: UpdateOrgBody }>('/api/v1/orgs/:org_id', {
    preHandler: [fastify.authenticate, requireOrgRole('admin')],
    schema: {
      tags: ['orgs'],
      summary: 'Update your organization\'s index record',
      params: {
        type: 'object',
        required: ['org_id'],
        properties: { org_id: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          display_name:  { type: 'string', minLength: 1, maxLength: 255 },
          domain:        { type: 'string', minLength: 3, maxLength: 255 },
          registry_url:  { type: 'string', pattern: '^https?://', maxLength: 512 },
          ttl_seconds:   { type: 'integer', minimum: 3600, maximum: 604800 },
        },
      },
      response: {
        200: INDEX_RECORD_SCHEMA,
        403: apiErrorSchema,
        404: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const body = request.body;
    const updated = await updateOrganization(request.params.org_id, {
      displayName:  body.display_name,
      domain:       body.domain,
      registryUrl:  body.registry_url,
      ttlSeconds:   body.ttl_seconds,
    });
    if (!updated) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: `org "${request.params.org_id}" not found` });
    }

    return reply.send(toIndexRecord(updated));
  });

  // Suspend org
  fastify.delete<{ Params: { org_id: string } }>('/api/v1/orgs/:org_id/suspend', {
    preHandler: [fastify.authenticate, requireOrgRole('admin')],
    schema: {
      tags: ['orgs'],
      summary: 'Suspend your organization',
      params: {
        type: 'object',
        required: ['org_id'],
        properties: { org_id: { type: 'string' } },
      },
      response: {
        200: INDEX_RECORD_SCHEMA,
        403: apiErrorSchema,
        404: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const suspended = await suspendOrganization(request.params.org_id);
    if (!suspended) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: `org "${request.params.org_id}" not found` });
    }

    return reply.send(toIndexRecord(suspended));
  });

  // Reactivate a suspended org
  fastify.post<{ Params: { org_id: string } }>('/api/v1/orgs/:org_id/reactivate', {
    preHandler: [fastify.authenticate, requireOrgRole('admin')],
    schema: {
      tags: ['orgs'],
      summary: 'Reactivate a suspended organization',
      params: {
        type: 'object',
        required: ['org_id'],
        properties: { org_id: { type: 'string' } },
      },
      response: {
        200: INDEX_RECORD_SCHEMA,
        403: apiErrorSchema,
        404: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const reactivated = await reactivateOrganization(request.params.org_id);
    if (!reactivated) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: `org "${request.params.org_id}" not found` });
    }

    return reply.send(toIndexRecord(reactivated));
  });

  // Hard-delete org
  fastify.delete<{ Params: { org_id: string } }>('/api/v1/orgs/:org_id', {
    preHandler: [fastify.authenticate, requireOrgRole('admin')],
    schema: {
      tags: ['orgs'],
      summary: 'Permanently delete your organization',
      params: {
        type: 'object',
        required: ['org_id'],
        properties: { org_id: { type: 'string' } },
      },
      response: {
        204: { type: 'null' },
        403: apiErrorSchema,
        404: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const deleted = await deleteOrganization(request.params.org_id);
    if (!deleted) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: `org "${request.params.org_id}" not found` });
    }

    return reply.code(204).send();
  });
}
