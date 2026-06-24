import { getSql } from '../client.js';
import type { IndexRecord, PublisherBlock } from '../../types/api/index-record.js';

/** Domain type — camelCase (postgres.camel maps snake_case columns). */
export interface Organization {
  id: string;
  orgId: string;
  displayName: string;
  domain: string | null;
  contactEmail: string;
  registryUrl: string | null;
  emailVerified: boolean;
  verifyToken: string | null;
  verifyTokenExpiresAt: Date | null;
  domainVerified: boolean;
  domainChallenge: string | null;
  domainChallengeExpiresAt: Date | null;
  domainVerifiedAt: Date | null;
  ttlSeconds: number;
  status: 'pending' | 'active' | 'suspended';
  createdAt: Date;
  updatedAt: Date;

  // AI Catalog fields
  identifier: string | null;
  mediaType: string;
  description: string | null;
  tags: string[];
  publisher: PublisherBlock | null;
  catalogMetadata: Record<string, unknown> | null;
  entryData: Record<string, unknown> | null;
}

export interface InsertOrgParams {
  orgId: string;
  displayName: string;
  domain?: string | null;
  contactEmail: string;
  registryUrl?: string | null;
  verifyToken: string;
  verifyTokenExpiresAt: Date;
  ttlSeconds?: number;
  identifier?: string;
  mediaType?: string;
  description?: string | null;
  tags?: string[];
  publisher?: PublisherBlock | null;
  catalogMetadata?: Record<string, unknown> | null;
  entryData?: Record<string, unknown> | null;
}

export interface UpdateOrgParams {
  displayName?: string;
  domain?: string;
  registryUrl?: string | null;
  ttlSeconds?: number;
  description?: string | null;
  tags?: string[];
  publisher?: PublisherBlock | null;
  catalogMetadata?: Record<string, unknown> | null;
  entryData?: Record<string, unknown> | null;
}

/** Maps a domain Organization to the wire IndexRecord shape. */
export function toIndexRecord(org: Organization): IndexRecord {
  return {
    org_id:         org.orgId,
    display_name:   org.displayName,
    domain:         org.domain,
    registry_url:   org.registryUrl,
    ttl_seconds:    org.ttlSeconds,
    status:         org.status,
    email_verified: org.emailVerified,
    domain_verified: org.domainVerified,
    created_at:     org.createdAt.toISOString(),
    updated_at:     org.updatedAt.toISOString(),
    identifier:     org.identifier ?? undefined,
    media_type:     org.mediaType,
    description:    org.description,
    tags:           org.tags,
    publisher:      org.publisher ?? undefined,
    metadata:       org.catalogMetadata ?? undefined,
    data:           org.entryData ?? undefined,
  };
}

/**
 * Finds an organization by its org_id slug.
 * Returns null if not found.
 */
export async function findByOrgId(orgId: string): Promise<Organization | null> {
  const sql = getSql();
  const rows = await sql<Organization[]>`
    SELECT * FROM organizations WHERE org_id = ${orgId} LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Finds an organization by domain name.
 * Returns null if not found.
 */
export async function findByDomain(domain: string): Promise<Organization | null> {
  const sql = getSql();
  const rows = await sql<Organization[]>`
    SELECT * FROM organizations WHERE domain = ${domain} LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Finds an organization by its stored identifier URN.
 * Used for email-identity lookups (e.g. urn:ai:email:john@example.com).
 */
export async function findByIdentifier(identifier: string): Promise<Organization | null> {
  const sql = getSql();
  const rows = await sql<Organization[]>`
    SELECT * FROM organizations WHERE identifier = ${identifier} LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Returns all organizations a user is a member of.
 */
export async function findByUserId(userId: string): Promise<Organization[]> {
  const sql = getSql();
  return sql<Organization[]>`
    SELECT o.* FROM organizations o
    JOIN org_memberships m ON m.org_id = o.org_id
    WHERE m.user_id = ${userId}
    ORDER BY o.created_at DESC
  `;
}

/**
 * Returns all active organizations ordered by creation date.
 */
export async function findAllActive(): Promise<Organization[]> {
  const sql = getSql();
  return sql<Organization[]>`
    SELECT * FROM organizations
    WHERE status = 'active'
    ORDER BY created_at ASC
  `;
}

/**
 * Inserts a new organization with status='pending'.
 * Returns the inserted organization.
 */
export async function insertOrganization(params: InsertOrgParams): Promise<Organization> {
  const sql = getSql();
  const identifier = params.identifier ?? (params.domain ? `urn:ai:domain:${params.domain}` : null);
  const rows = await sql<Organization[]>`
    INSERT INTO organizations
      (org_id, display_name, domain, contact_email, registry_url,
       verify_token, verify_token_expires_at, ttl_seconds,
       identifier, media_type, description, tags, publisher, catalog_metadata, entry_data)
    VALUES
      (${params.orgId}, ${params.displayName}, ${params.domain ?? null}, ${params.contactEmail},
       ${params.registryUrl ?? null}, ${params.verifyToken}, ${params.verifyTokenExpiresAt},
       ${params.ttlSeconds ?? 86400},
       ${identifier},
       ${params.mediaType ?? 'application/ai-catalog+json'},
       ${params.description ?? null},
       ${sql.array(params.tags ?? [])},
       ${params.publisher ? sql.json(JSON.parse(JSON.stringify(params.publisher))) : null},
       ${params.catalogMetadata ? sql.json(JSON.parse(JSON.stringify(params.catalogMetadata))) : null},
       ${params.entryData ? sql.json(JSON.parse(JSON.stringify(params.entryData))) : null})
    RETURNING *
  `;
  return rows[0]!;
}

/**
 * Applies a partial update to an organization.
 * Only provided fields are changed; updated_at is always refreshed.
 *
 * Changing the `domain` invalidates the ownership proof: the prior verification
 * was for the old domain, so domain_verified and any pending challenge are
 * cleared, and an active org reverts to 'pending' until the new domain is
 * re-verified. This keeps the invariant "active ⇒ domain_verified" — otherwise
 * an admin could verify one domain then silently swap in another they don't own.
 *
 * Returns null if org_id not found.
 */
export async function updateOrganization(
  orgId: string,
  patch: UpdateOrgParams,
): Promise<Organization | null> {
  const sql = getSql();
  const newDomain = patch.domain ?? null;
  const rows = await sql<Organization[]>`
    UPDATE organizations SET
      display_name     = COALESCE(${patch.displayName ?? null}, display_name),
      domain           = COALESCE(${newDomain}, domain),
      registry_url     = COALESCE(${patch.registryUrl ?? null}, registry_url),
      ttl_seconds      = COALESCE(${patch.ttlSeconds ?? null}, ttl_seconds),
      description      = COALESCE(${patch.description ?? null}, description),
      tags             = COALESCE(${patch.tags != null ? sql.array(patch.tags) : null}, tags),
      publisher        = COALESCE(${patch.publisher ? sql.json(JSON.parse(JSON.stringify(patch.publisher))) : null}, publisher),
      catalog_metadata = COALESCE(${patch.catalogMetadata ? sql.json(JSON.parse(JSON.stringify(patch.catalogMetadata))) : null}, catalog_metadata),
      entry_data       = COALESCE(${patch.entryData ? sql.json(JSON.parse(JSON.stringify(patch.entryData))) : null}, entry_data),
      domain_verified = CASE
        WHEN ${newDomain}::text IS NOT NULL AND ${newDomain}::text <> domain THEN FALSE
        ELSE domain_verified END,
      domain_verified_at = CASE
        WHEN ${newDomain}::text IS NOT NULL AND ${newDomain}::text <> domain THEN NULL
        ELSE domain_verified_at END,
      domain_challenge = CASE
        WHEN ${newDomain}::text IS NOT NULL AND ${newDomain}::text <> domain THEN NULL
        ELSE domain_challenge END,
      domain_challenge_expires_at = CASE
        WHEN ${newDomain}::text IS NOT NULL AND ${newDomain}::text <> domain THEN NULL
        ELSE domain_challenge_expires_at END,
      status = CASE
        WHEN ${newDomain}::text IS NOT NULL AND ${newDomain}::text <> domain AND status = 'active' THEN 'pending'
        ELSE status END,
      updated_at       = NOW()
    WHERE org_id = ${orgId}
    RETURNING *
  `;
  return rows[0] ?? null;
}

/**
 * Marks an organization's contact email as verified and clears the token.
 *
 * This proves contact-email reachability only — it does NOT activate the org.
 * Activation is gated on domain ownership (see markDomainVerified). Returns
 * null if no org matched the token or the token has expired.
 */
export async function markEmailVerifiedByToken(token: string): Promise<Organization | null> {
  const sql = getSql();
  const rows = await sql<Organization[]>`
    UPDATE organizations SET
      email_verified           = TRUE,
      verify_token             = NULL,
      verify_token_expires_at  = NULL,
      updated_at               = NOW()
    WHERE verify_token = ${token}
      AND verify_token_expires_at > NOW()
    RETURNING *
  `;
  return rows[0] ?? null;
}

/**
 * Stores (or replaces) the pending DNS TXT challenge for an org's domain.
 * Regenerating invalidates any previously issued challenge. Returns null if
 * org_id not found.
 */
export async function setDomainChallenge(
  orgId: string,
  challenge: string,
  expiresAt: Date,
): Promise<Organization | null> {
  const sql = getSql();
  const rows = await sql<Organization[]>`
    UPDATE organizations SET
      domain_challenge            = ${challenge},
      domain_challenge_expires_at = ${expiresAt},
      updated_at                  = NOW()
    WHERE org_id = ${orgId}
    RETURNING *
  `;
  return rows[0] ?? null;
}

/**
 * Marks an org's domain as verified after a successful DNS TXT check, clears
 * the challenge, and activates the org if it was still pending. A suspended
 * org is NOT auto-reactivated — only 'pending' transitions to 'active'.
 * Returns null if org_id not found.
 */
export async function markDomainVerified(orgId: string): Promise<Organization | null> {
  const sql = getSql();
  const rows = await sql<Organization[]>`
    UPDATE organizations SET
      domain_verified             = TRUE,
      domain_verified_at          = NOW(),
      domain_challenge            = NULL,
      domain_challenge_expires_at = NULL,
      status                      = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
      updated_at                  = NOW()
    WHERE org_id = ${orgId}
    RETURNING *
  `;
  return rows[0] ?? null;
}

/**
 * Sets an organization's status to 'suspended'.
 * Returns null if org_id not found.
 */
export async function suspendOrganization(orgId: string): Promise<Organization | null> {
  const sql = getSql();
  const rows = await sql<Organization[]>`
    UPDATE organizations SET
      status     = 'suspended',
      updated_at = NOW()
    WHERE org_id = ${orgId}
    RETURNING *
  `;
  return rows[0] ?? null;
}

/**
 * Reactivates a suspended organization by setting status back to 'active'.
 * Returns null if org_id not found.
 */
export async function reactivateOrganization(orgId: string): Promise<Organization | null> {
  const sql = getSql();
  const rows = await sql<Organization[]>`
    UPDATE organizations SET
      status     = 'active',
      updated_at = NOW()
    WHERE org_id = ${orgId}
    RETURNING *
  `;
  return rows[0] ?? null;
}

/**
 * Hard-deletes an organization and its memberships (cascade).
 * Returns true if a row was deleted, false if org_id not found.
 */
export async function deleteOrganization(orgId: string): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`
    DELETE FROM organizations WHERE org_id = ${orgId} RETURNING org_id
  `;
  return rows.length > 0;
}

/**
 * Full-text keyword search across org_id, domain, and display_name.
 * Returns active organizations matching the query.
 */
export async function searchOrganizations(query: string): Promise<Organization[]> {
  const sql = getSql();
  const pattern = `%${query.toLowerCase()}%`;
  return sql<Organization[]>`
    SELECT * FROM organizations
    WHERE status = 'active'
      AND (
        LOWER(org_id)        LIKE ${pattern}
        OR LOWER(COALESCE(domain, ''))      LIKE ${pattern}
        OR LOWER(display_name)              LIKE ${pattern}
        OR LOWER(COALESCE(identifier, ''))  LIKE ${pattern}
      )
    ORDER BY org_id ASC
    LIMIT 50
  `;
}
