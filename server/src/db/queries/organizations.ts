import { getSql } from '../client.js';
import type { IndexRecord } from '../../types/api/index-record.js';

/** Domain type — camelCase (postgres.camel maps snake_case columns). */
export interface Organization {
  id: string;
  orgId: string;
  displayName: string;
  domain: string;
  contactEmail: string;
  registryUrl: string;
  emailVerified: boolean;
  verifyToken: string | null;
  verifyTokenExpiresAt: Date | null;
  ttlSeconds: number;
  status: 'pending' | 'active' | 'suspended';
  createdAt: Date;
  updatedAt: Date;
}

export interface InsertOrgParams {
  orgId: string;
  displayName: string;
  domain: string;
  contactEmail: string;
  registryUrl: string;
  verifyToken: string;
  verifyTokenExpiresAt: Date;
  ttlSeconds?: number;
}

export interface UpdateOrgParams {
  displayName?: string;
  domain?: string;
  registryUrl?: string;
  ttlSeconds?: number;
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
    created_at:     org.createdAt.toISOString(),
    updated_at:     org.updatedAt.toISOString(),
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
  const rows = await sql<Organization[]>`
    INSERT INTO organizations
      (org_id, display_name, domain, contact_email, registry_url,
       verify_token, verify_token_expires_at, ttl_seconds)
    VALUES
      (${params.orgId}, ${params.displayName}, ${params.domain}, ${params.contactEmail},
       ${params.registryUrl}, ${params.verifyToken}, ${params.verifyTokenExpiresAt},
       ${params.ttlSeconds ?? 86400})
    RETURNING *
  `;
  return rows[0]!;
}

/**
 * Applies a partial update to an organization.
 * Only provided fields are changed; updated_at is always refreshed.
 * Returns null if org_id not found.
 */
export async function updateOrganization(
  orgId: string,
  patch: UpdateOrgParams,
): Promise<Organization | null> {
  const sql = getSql();
  const rows = await sql<Organization[]>`
    UPDATE organizations SET
      display_name = COALESCE(${patch.displayName ?? null}, display_name),
      domain       = COALESCE(${patch.domain ?? null}, domain),
      registry_url = COALESCE(${patch.registryUrl ?? null}, registry_url),
      ttl_seconds  = COALESCE(${patch.ttlSeconds ?? null}, ttl_seconds),
      updated_at   = NOW()
    WHERE org_id = ${orgId}
    RETURNING *
  `;
  return rows[0] ?? null;
}

/**
 * Marks an organization's email as verified and sets status to 'active'.
 * Clears the verify_token. Returns null if no org matched the token.
 */
export async function activateByVerifyToken(token: string): Promise<Organization | null> {
  const sql = getSql();
  const rows = await sql<Organization[]>`
    UPDATE organizations SET
      email_verified           = TRUE,
      verify_token             = NULL,
      verify_token_expires_at  = NULL,
      status                   = 'active',
      updated_at               = NOW()
    WHERE verify_token = ${token}
      AND verify_token_expires_at > NOW()
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
        LOWER(org_id)       LIKE ${pattern}
        OR LOWER(domain)       LIKE ${pattern}
        OR LOWER(display_name) LIKE ${pattern}
      )
    ORDER BY org_id ASC
    LIMIT 50
  `;
}
