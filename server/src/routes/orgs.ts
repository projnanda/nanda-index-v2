import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { findByOrgId, insertOrganization, updateOrganization, suspendOrganization, toIndexRecord } from '../db/queries/organizations.js';
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
 * Protected org management routes.
 * All routes require a valid JWT (preHandler: fastify.authenticate).
 *
 * POST   /api/v1/orgs             — create an org (sends verification email)
 * GET    /api/v1/orgs/:org_id     — get own org (must be a member)
 * PUT    /api/v1/orgs/:org_id     — update index record fields
 * DELETE /api/v1/orgs/:org_id     — suspend org
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

    const org = await insertOrganization({
      orgId:        body.org_id,
      displayName:  body.display_name,
      domain:       body.domain,
      contactEmail: body.contact_email,
      registryUrl:  body.registry_url,
      verifyToken,
      ttlSeconds:   body.ttl_seconds,
    });

    await insertMembership(user.userId, org.orgId, 'admin');
    await sendVerificationEmail(body.contact_email, verifyToken, body.org_id);

    return reply.code(201).send(toIndexRecord(org));
  });

  // Get own org (must be member)
  fastify.get<{ Params: { org_id: string } }>('/api/v1/orgs/:org_id', {
    preHandler: [fastify.authenticate],
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
    const user = request.user as JwtPayload;

    const membership = await checkMembership(user.userId, request.params.org_id);
    if (!membership) {
      return reply.code(403).send({ error: 'FORBIDDEN', detail: 'you are not a member of this organization' });
    }

    const org = await findByOrgId(request.params.org_id);
    if (!org) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: `org "${request.params.org_id}" not found` });
    }

    return reply.send(toIndexRecord(org));
  });

  // Update own org's index record
  fastify.put<{ Params: { org_id: string }; Body: UpdateOrgBody }>('/api/v1/orgs/:org_id', {
    preHandler: [fastify.authenticate],
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
    const user = request.user as JwtPayload;

    const membership = await checkMembership(user.userId, request.params.org_id);
    if (!membership) {
      return reply.code(403).send({ error: 'FORBIDDEN', detail: 'you are not a member of this organization' });
    }

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
  fastify.delete<{ Params: { org_id: string } }>('/api/v1/orgs/:org_id', {
    preHandler: [fastify.authenticate],
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
    const user = request.user as JwtPayload;

    const membership = await checkMembership(user.userId, request.params.org_id);
    if (!membership) {
      return reply.code(403).send({ error: 'FORBIDDEN', detail: 'you are not a member of this organization' });
    }

    const suspended = await suspendOrganization(request.params.org_id);
    if (!suspended) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: `org "${request.params.org_id}" not found` });
    }

    return reply.send(toIndexRecord(suspended));
  });
}
