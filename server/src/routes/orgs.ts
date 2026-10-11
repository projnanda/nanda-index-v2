import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { findByOrgId, findByDomain, findByIdentifier, insertOrganization, updateOrganization, suspendOrganization, reactivateOrganization, deleteOrganization, setDomainChallenge, markDomainVerified, toIndexRecord, type Organization } from '../db/queries/organizations.js';
import { insertMembership, checkMembership } from '../db/queries/orgMemberships.js';
import { sendVerificationEmail } from '../services/email.js';
import { generateRepresentativeQueries } from '../services/llmEnrichment.js';
import { buildConfig } from '../config/index.js';
import {
  challengeRecordName,
  challengeRecordValue,
  lookupDomainToken,
  CHALLENGE_TTL_MS,
} from '../services/domainVerification.js';
import { INDEX_RECORD_SCHEMA, TRUST_MANIFEST_SCHEMA, EXTENSIONS_SCHEMA } from '../types/api/index-record.js';
import { apiErrorSchema } from '../types/api/common.js';
import type { JwtPayload } from '../plugins/jwt.js';
import type { TrustManifest } from '../types/api/index-record.js';
import { isFqdn, PERSONAL_CARD_HOST } from '../lib/airUrn.js';
import {
  ALLOWED_MEDIA_TYPES,
  HOSTING_PATHS,
  EntryProfileError,
  buildEntryProfile,
  updateEntryProfile,
  type CatalogExtensions,
  type EntryProfile,
  type HostingPath,
} from '../lib/entryProfile.js';

/** Only the publisher's display name is client-controlled; its identifier is the verified domain. */
const PUBLISHER_INPUT_SCHEMA = {
  type: 'object',
  required: ['displayName'],
  properties: { displayName: { type: 'string', minLength: 1, maxLength: 255 } },
} as const;

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** PUT /api/v1/orgs/:org_id body — exactly the fields an admin may change. */
const UPDATE_ORG_BODY_SCHEMA = {
  type: 'object',
  properties: {
    display_name:     { type: 'string', minLength: 1, maxLength: 255 },
    domain:           { type: 'string', maxLength: 255 },
    registry_url:     { type: 'string', maxLength: 512 },
    ttl_seconds:      { type: 'integer', minimum: 3600, maximum: 604800 },
    description:      { type: 'string', maxLength: 1000 },
    tags:             { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 20 },
    version:          { type: 'string', maxLength: 64 },
    publisher:        PUBLISHER_INPUT_SCHEMA,
    extensions:       EXTENSIONS_SCHEMA,
    entry_data:       { type: 'object', additionalProperties: true },
    // Nullable: an explicit null revokes/clears the stored manifest.
    trust_manifest:   { anyOf: [{ type: 'null' }, TRUST_MANIFEST_SCHEMA] },
  },
} as const;

const EDITABLE_FIELDS: readonly string[] = Object.keys(UPDATE_ORG_BODY_SCHEMA.properties);
const EDITABLE_PUBLISHER_FIELDS: readonly string[] = Object.keys(PUBLISHER_INPUT_SCHEMA.properties);

/** Fields in an update body that can't be changed (top level, plus `publisher.*`). */
function unknownUpdateFields(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return [];
  const fields = body as Record<string, unknown>;
  const topLevel = Object.keys(fields).filter((key) => !EDITABLE_FIELDS.includes(key));
  const publisher = fields.publisher;
  const nested = typeof publisher === 'object' && publisher !== null
    ? Object.keys(publisher).filter((key) => !EDITABLE_PUBLISHER_FIELDS.includes(key)).map((key) => `publisher.${key}`)
    : [];
  return [...topLevel, ...nested];
}

/**
 * Rejects an update that names a field it can't change, rather than silently
 * dropping it — a typo or a read-only field (contact_email, identifier, …)
 * would otherwise look like a successful update. Server-owned keys inside
 * extensions are still dropped, not rejected, so a record copied from a GET
 * can be sent back.
 */
async function rejectUnknownUpdateFields(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const unknown = unknownUpdateFields(request.body);
  if (unknown.length === 0) return;
  reply.code(400).send({
    error: 'UNKNOWN_FIELDS',
    detail: `these fields cannot be changed via PUT: ${unknown.join(', ')}. Editable fields: ${EDITABLE_FIELDS.join(', ')} (publisher: ${EDITABLE_PUBLISHER_FIELDS.join(', ')})`,
  });
}

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
  registry_url: string;
  ttl_seconds?: number;
  identifier?: string;
  media_type?: string;
  description?: string;
  tags?: string[];
  publisher?: { displayName: string };
  extensions?: CatalogExtensions;
  entry_data?: Record<string, unknown>;
  version?: string;
  trust_manifest?: TrustManifest;
}

interface UpdateOrgBody {
  display_name?: string;
  domain?: string;
  registry_url?: string | null;
  ttl_seconds?: number;
  description?: string;
  tags?: string[];
  publisher?: { displayName: string };
  extensions?: CatalogExtensions;
  entry_data?: Record<string, unknown>;
  version?: string;
  /** undefined = leave unchanged; null = clear the stored manifest. */
  trust_manifest?: TrustManifest | null;
}

interface ApiError {
  status: 400 | 409;
  body: { error: string; detail: string };
}

const validationError = (detail: string): ApiError => ({ status: 400, body: { error: 'VALIDATION', detail } });
const conflictError = (detail: string): ApiError => ({ status: 409, body: { error: 'CONFLICT', detail } });

/** Checks the create body's hosting-path invariants; returns the first problem or null. */
function validateCreateBody(body: CreateOrgBody, path: HostingPath): ApiError | null {
  if (path === 'personal' && body.domain) {
    return validationError('personal registrations have no domain — the identifier is anchored to the card host');
  }
  if (path !== 'personal' && !body.domain) {
    return validationError(`domain is required for ${path} registrations`);
  }
  if (body.domain && !isFqdn(body.domain)) {
    return validationError('domain must be a valid hostname (e.g. acme.com)');
  }
  if (!/^https?:\/\//.test(body.registry_url)) {
    return validationError('registry_url must start with https://');
  }
  return null;
}

/** Rejects an identifier or domain another entry already holds. */
/**
 * A personal registration whose email was never verified and whose
 * verification link has expired can never activate (there is no resend), so
 * it must not keep holding the identifier: otherwise anyone could register a
 * victim's email and lock them out of their own identifier forever. Domain
 * rows are excluded — they activate via DNS, independently of the email link.
 */
function isAbandonedPersonal(org: Organization, now: Date = new Date()): boolean {
  return org.domain === null
    && org.status === 'pending'
    && !org.emailVerified
    && (org.verifyTokenExpiresAt === null || org.verifyTokenExpiresAt <= now);
}

/**
 * Rejects an identifier or domain another entry already holds. An abandoned
 * personal registration holding the identifier is deleted instead, freeing it.
 */
async function findConflict(identifier: string, domain: string | null, selfOrgId?: string): Promise<ApiError | null> {
  const byIdentifier = await findByIdentifier(identifier);
  if (byIdentifier && byIdentifier.orgId !== selfOrgId) {
    if (!isAbandonedPersonal(byIdentifier)) {
      return conflictError(`identifier "${identifier}" is already registered`);
    }
    await deleteOrganization(byIdentifier.orgId);
  }
  const byDomain = domain ? await findByDomain(domain) : null;
  if (byDomain && byDomain.orgId !== selfOrgId) {
    return conflictError(`domain "${domain}" is already registered`);
  }
  return null;
}

/** Postgres unique_violation — a concurrent registration won the identifier/domain race. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}

const RACE_CONFLICT = conflictError('identifier or domain was registered concurrently — retry');

/** Current stored entry as an EntryProfile, for updateEntryProfile. */
function profileOf(org: Organization): EntryProfile {
  return {
    identifier: org.identifier,
    mediaType: org.mediaType,
    publisher: org.publisher ?? {
      identifier: org.domain ?? PERSONAL_CARD_HOST.domain,
      displayName: org.domain ? org.displayName : PERSONAL_CARD_HOST.displayName,
      identityType: 'dns',
    },
    extensions: org.extensions,
  };
}

function buildProfileOrError(body: CreateOrgBody, path: HostingPath): EntryProfile | ApiError {
  try {
    return buildEntryProfile({
      path,
      orgId: body.org_id,
      domain: body.domain ?? null,
      contactEmail: body.contact_email,
      displayName: body.display_name,
      identifier: body.identifier,
      mediaType: body.media_type,
      publisherDisplayName: body.publisher?.displayName,
      extensions: body.extensions,
    });
  } catch (err) {
    if (err instanceof EntryProfileError) return validationError(err.message);
    throw err;
  }
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
        required: ['org_id', 'display_name', 'contact_email', 'registry_url'],
        properties: {
          org_id:        { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*[a-z0-9]$', minLength: 2, maxLength: 64 },
          display_name:  { type: 'string', minLength: 1, maxLength: 255 },
          hosting_path:  { type: 'string', enum: HOSTING_PATHS },
          domain:        { type: 'string', maxLength: 255 },
          contact_email: { type: 'string', format: 'email' },
          registry_url:  { type: 'string', maxLength: 512 },
          ttl_seconds:   { type: 'integer', minimum: 3600, maximum: 604800 },
          identifier:    { type: 'string', maxLength: 512 },
          media_type:    { type: 'string', maxLength: 128, enum: ALLOWED_MEDIA_TYPES },
          description:   { type: 'string', maxLength: 1000 },
          tags:          { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 20 },
          version:       { type: 'string', maxLength: 64 },
          publisher:     PUBLISHER_INPUT_SCHEMA,
          extensions:    EXTENSIONS_SCHEMA,
          entry_data:    { type: 'object', additionalProperties: true },
          trust_manifest: TRUST_MANIFEST_SCHEMA,
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

    const invalid = validateCreateBody(body, path);
    if (invalid) return reply.code(invalid.status).send(invalid.body);

    const profile = buildProfileOrError(body, path);
    if ('status' in profile) return reply.code(profile.status).send(profile.body);

    if (await findByOrgId(body.org_id)) {
      return reply.code(409).send({ error: 'CONFLICT', detail: `org_id "${body.org_id}" is already taken` });
    }
    const conflict = await findConflict(profile.identifier, body.domain ?? null);
    if (conflict) return reply.code(conflict.status).send(conflict.body);

    const verifyToken = randomBytes(32).toString('hex');
    const verifyTokenExpiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);

    // Best-effort write-time enrichment — never blocks or fails registration.
    // See llmEnrichment.ts: closes the phrasing gap plain keyword/stemmed
    // search can't bridge (e.g. "help me bake" vs a "bakery" tag).
    const representativeQueries = await generateRepresentativeQueries(
      { displayName: body.display_name, description: body.description ?? null, tags: body.tags ?? [] },
      buildConfig().llmEnrichment,
    );

    let org: Organization;
    try {
      org = await insertOrganization({
        orgId:                body.org_id,
        displayName:          body.display_name,
        domain:               body.domain?.toLowerCase() ?? null,
        contactEmail:         body.contact_email,
        registryUrl:          body.registry_url,
        verifyToken,
        verifyTokenExpiresAt,
        ttlSeconds:           body.ttl_seconds,
        identifier:           profile.identifier,
        mediaType:            profile.mediaType,
        description:          body.description,
        tags:                 body.tags,
        publisher:            profile.publisher,
        extensions:           profile.extensions,
        entryData:            body.entry_data,
        version:              body.version,
        trustManifest:        body.trust_manifest,
        representativeQueries,
      });
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(RACE_CONFLICT.status).send(RACE_CONFLICT.body);
      throw err;
    }

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
    preHandler: [fastify.authenticate, requireOrgRole('admin'), rejectUnknownUpdateFields],
    schema: {
      tags: ['orgs'],
      summary: 'Update your organization\'s index record',
      params: {
        type: 'object',
        required: ['org_id'],
        properties: { org_id: { type: 'string' } },
      },
      body: UPDATE_ORG_BODY_SCHEMA,
      response: {
        200: INDEX_RECORD_SCHEMA,
        400: apiErrorSchema,
        403: apiErrorSchema,
        404: apiErrorSchema,
        409: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const body = request.body;
    const current = await findByOrgId(request.params.org_id);
    if (!current) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: `org "${request.params.org_id}" not found` });
    }

    if (body.domain !== undefined) {
      if (!current.domain) {
        return reply.code(400).send({ error: 'VALIDATION', detail: 'personal registrations cannot take a domain' });
      }
      if (!isFqdn(body.domain)) {
        return reply.code(400).send({ error: 'VALIDATION', detail: 'domain must be a valid hostname (e.g. acme.com)' });
      }
    }
    if (body.registry_url != null && !/^https?:\/\//.test(body.registry_url)) {
      return reply.code(400).send({ error: 'VALIDATION', detail: 'registry_url must start with https://' });
    }

    const next = updateEntryProfile(profileOf(current), {
      domain: body.domain,
      publisherDisplayName: body.publisher?.displayName,
      extensions: body.extensions,
    });
    const conflict = await findConflict(next.identifier, body.domain?.toLowerCase() ?? null, current.orgId);
    if (conflict) return reply.code(conflict.status).send(conflict.body);

    // Only re-run enrichment when a field it depends on actually changed —
    // avoids an LLM call on unrelated updates (e.g. just registry_url).
    // Merged with the current row so the prompt reflects the org's full state.
    const representativeQueries =
      body.display_name !== undefined || body.description !== undefined || body.tags !== undefined
        ? await generateRepresentativeQueries(
            {
              displayName: body.display_name ?? current.displayName,
              description: body.description ?? current.description,
              tags: body.tags ?? current.tags,
            },
            buildConfig().llmEnrichment,
          )
        : undefined;

    let updated: Organization | null;
    try {
      updated = await updateOrganization(request.params.org_id, {
        displayName:     body.display_name,
        domain:          body.domain?.toLowerCase(),
        identifier:      next.identifier,
        registryUrl:     body.registry_url,
        ttlSeconds:      body.ttl_seconds,
        description:     body.description,
        tags:            body.tags,
        publisher:       next.publisher,
        extensions:      next.extensions,
        entryData:       body.entry_data,
        version:         body.version,
        // No ?? null here: undefined (omitted) must stay distinct from null (clear).
        trustManifest:   body.trust_manifest,
        representativeQueries,
      });
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(RACE_CONFLICT.status).send(RACE_CONFLICT.body);
      throw err;
    }
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
