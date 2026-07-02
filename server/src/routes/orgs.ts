import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { findByOrgId, insertOrganization, updateOrganization, suspendOrganization, reactivateOrganization, deleteOrganization, setDomainChallenge, markDomainVerified, toIndexRecord } from '../db/queries/organizations.js';
import { insertMembership, checkMembership } from '../db/queries/orgMemberships.js';
import { sendVerificationEmail } from '../services/email.js';
import {
  challengeRecordName,
  challengeRecordValue,
  lookupDomainToken,
  CHALLENGE_TTL_MS,
} from '../services/domainVerification.js';
import { INDEX_RECORD_SCHEMA } from '../types/api/index-record.js';
import { apiErrorSchema } from '../types/api/common.js';
import type { JwtPayload } from '../plugins/jwt.js';
import type { PublisherBlock } from '../types/api/index-record.js';

type HostingPath = 'registry' | 'dns-aid' | 'smb' | 'personal';

/** Wire shape returned when an org admin requests a DNS challenge. */
const DOMAIN_CHALLENGE_SCHEMA = {
  type: 'object',
  required: ['domain', 'record_name', 'record_type', 'record_value', 'expires_at'],
  properties: {
    domain:       { type: 'string' },
    record_name:  { type: 'string' },
    record_type:  { type: 'string' },
    record_value: { type: 'string' },
    expires_at:   { type: 'string' },
  },
} as const;

interface CreateOrgBody {
  org_id: string;
  display_name: string;
  hosting_path?: HostingPath;
  domain?: string | null;
  contact_email: string;
  registry_url?: string | null;
  ttl_seconds?: number;
  identifier?: string;
  media_type?: string;
  description?: string;
  tags?: string[];
  publisher?: PublisherBlock;
  catalog_metadata?: Record<string, unknown>;
  entry_data?: Record<string, unknown>;
  version?: string;
}

interface UpdateOrgBody {
  display_name?: string;
  domain?: string;
  registry_url?: string | null;
  ttl_seconds?: number;
  description?: string;
  tags?: string[];
  publisher?: PublisherBlock;
  catalog_metadata?: Record<string, unknown>;
  entry_data?: Record<string, unknown>;
  version?: string;
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
 *   POST   /api/v1/orgs                          — create an org (caller becomes admin; sends verification email)
 *   GET    /api/v1/orgs/:org_id                  — read own org              (member)
 *   POST   /api/v1/orgs/:org_id/domain-challenge — issue a DNS TXT challenge (admin)
 *   POST   /api/v1/orgs/:org_id/verify-domain    — check DNS, activate org   (admin)
 *   PUT    /api/v1/orgs/:org_id                  — update index record       (admin)
 *   DELETE /api/v1/orgs/:org_id/suspend          — suspend org               (admin)
 *   POST   /api/v1/orgs/:org_id/reactivate       — reactivate suspended      (admin)
 *   DELETE /api/v1/orgs/:org_id                  — permanently delete org    (admin)
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
        required: ['org_id', 'display_name', 'contact_email'],
        properties: {
          org_id:        { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*[a-z0-9]$', minLength: 2, maxLength: 64 },
          display_name:  { type: 'string', minLength: 1, maxLength: 255 },
          hosting_path:  { type: 'string', enum: ['registry', 'dns-aid', 'smb', 'personal'] },
          domain:        { type: 'string', maxLength: 255 },
          contact_email: { type: 'string', format: 'email' },
          registry_url:  { type: 'string', maxLength: 512 },
          ttl_seconds:   { type: 'integer', minimum: 3600, maximum: 604800 },
          identifier:    { type: 'string', maxLength: 512 },
          media_type:    { type: 'string', maxLength: 128,
                           enum: ['application/ai-catalog+json', 'application/vnd.dns-aid+json', 'application/a2a-agent-card+json', 'application/mcp-server-card+json', 'application/agentskill+zip'] },
          description:   { type: 'string', maxLength: 1000 },
          tags:          { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 20 },
          version:       { type: 'string', maxLength: 64 },
          publisher: {
            type: 'object',
            required: ['identifier', 'displayName'],
            properties: {
              identifier:   { type: 'string' },
              displayName:  { type: 'string' },
              identityType: { type: 'string' },
            },
          },
          catalog_metadata: { type: 'object', additionalProperties: true },
          entry_data:       { type: 'object', additionalProperties: true },
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

    const path = body.hosting_path ?? 'registry';
    const isDnsAid = path === 'dns-aid';
    const isPersonal = path === 'personal';

    // Domain: required for all paths except personal
    if (!isPersonal && !body.domain) {
      return reply.code(400).send({ error: 'VALIDATION', detail: 'domain is required for registry, dns-aid, and smb registrations' });
    }
    if (body.domain && !/^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(body.domain)) {
      return reply.code(400).send({ error: 'VALIDATION', detail: 'domain must be a valid hostname (e.g. acme.com)' });
    }

    // registry_url: required for registry, smb, personal — not for dns-aid
    if (!isDnsAid) {
      if (!body.registry_url) {
        return reply.code(400).send({ error: 'VALIDATION', detail: 'registry_url is required for registry, smb, and personal registrations' });
      }
      if (!/^https?:\/\//.test(body.registry_url)) {
        return reply.code(400).send({ error: 'VALIDATION', detail: 'registry_url must start with https://' });
      }
    }

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
      domain:               body.domain ?? null,
      contactEmail:         body.contact_email,
      registryUrl:          body.registry_url ?? null,
      verifyToken,
      verifyTokenExpiresAt,
      ttlSeconds:           body.ttl_seconds,
      identifier:           body.identifier,
      mediaType:            body.media_type,
      description:          body.description,
      tags:                 body.tags,
      publisher:            body.publisher,
      catalogMetadata:      body.catalog_metadata,
      entryData:            body.entry_data,
      version:              body.version,
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

  // Issue (or rotate) a DNS TXT challenge for the org's domain
  fastify.post<{ Params: { org_id: string } }>('/api/v1/orgs/:org_id/domain-challenge', {
    preHandler: [fastify.authenticate, requireOrgRole('admin')],
    schema: {
      tags: ['orgs'],
      summary: 'Issue a DNS TXT challenge to prove domain ownership',
      params: {
        type: 'object',
        required: ['org_id'],
        properties: { org_id: { type: 'string' } },
      },
      response: {
        200: DOMAIN_CHALLENGE_SCHEMA,
        403: apiErrorSchema,
        404: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const org = await findByOrgId(request.params.org_id);
    if (!org) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: `org "${request.params.org_id}" not found` });
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

    const updated = await setDomainChallenge(org.orgId, token, expiresAt);
    if (!updated) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: `org "${request.params.org_id}" not found` });
    }

    return reply.send({
      domain:       updated.domain,
      record_name:  challengeRecordName(updated.domain!),
      record_type:  'TXT',
      record_value: challengeRecordValue(token),
      expires_at:   expiresAt.toISOString(),
    });
  });

  // Check the DNS TXT record and, on success, mark the domain verified + activate
  fastify.post<{ Params: { org_id: string } }>('/api/v1/orgs/:org_id/verify-domain', {
    preHandler: [fastify.authenticate, requireOrgRole('admin')],
    schema: {
      tags: ['orgs'],
      summary: 'Verify the DNS TXT challenge and activate the organization',
      params: {
        type: 'object',
        required: ['org_id'],
        properties: { org_id: { type: 'string' } },
      },
      response: {
        200: INDEX_RECORD_SCHEMA,
        400: apiErrorSchema,
        403: apiErrorSchema,
        404: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const org = await findByOrgId(request.params.org_id);
    if (!org) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: `org "${request.params.org_id}" not found` });
    }

    if (!org.domainChallenge || !org.domainChallengeExpiresAt || org.domainChallengeExpiresAt <= new Date()) {
      return reply.code(400).send({
        error: 'NO_ACTIVE_CHALLENGE',
        detail: 'no active domain challenge — request one via POST /domain-challenge first',
      });
    }

    if (!org.domain) {
      return reply.code(400).send({ error: 'NO_DOMAIN', detail: 'this org has no domain to verify (personal email-identity org)' });
    }

    const expectedValue = challengeRecordValue(org.domainChallenge);
    const { verified, found } = await lookupDomainToken(org.domain, expectedValue);

    if (!verified) {
      const seen = found.length
        ? ` Found instead: ${found.slice(0, 5).map((v) => `"${v}"`).join(', ')}.`
        : '';
      return reply.code(400).send({
        error: 'DOMAIN_NOT_VERIFIED',
        detail: `expected TXT "${expectedValue}" at ${challengeRecordName(org.domain)}, but it was not found. DNS changes can take time to propagate — try again shortly.${seen}`,
      });
    }

    const updated = await markDomainVerified(org.orgId);
    if (!updated) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: `org "${request.params.org_id}" not found` });
    }

    return reply.send(toIndexRecord(updated));
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
          display_name:     { type: 'string', minLength: 1, maxLength: 255 },
          domain:           { type: 'string', maxLength: 255 },
          registry_url:     { type: 'string', maxLength: 512 },
          ttl_seconds:      { type: 'integer', minimum: 3600, maximum: 604800 },
          description:      { type: 'string', maxLength: 1000 },
          tags:             { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 20 },
          version:          { type: 'string', maxLength: 64 },
          publisher: {
            type: 'object',
            required: ['identifier', 'displayName'],
            properties: {
              identifier:   { type: 'string' },
              displayName:  { type: 'string' },
              identityType: { type: 'string' },
            },
          },
          catalog_metadata: { type: 'object', additionalProperties: true },
          entry_data:       { type: 'object', additionalProperties: true },
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
      displayName:     body.display_name,
      domain:          body.domain,
      registryUrl:     body.registry_url,
      ttlSeconds:      body.ttl_seconds,
      description:     body.description,
      tags:            body.tags,
      publisher:       body.publisher,
      catalogMetadata: body.catalog_metadata,
      entryData:       body.entry_data,
      version:         body.version,
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
