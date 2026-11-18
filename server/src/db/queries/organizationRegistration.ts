import { getSql } from '../client.js';
import { insertOrganization, type InsertOrgParams, type Organization } from './organizations.js';
import { insertMembership } from './orgMemberships.js';
import { lockVerifiedUserForOwnership } from './users.js';

/** Commit an entry and its administrator together, or leave neither behind. */
export async function createOwnedOrganization(
  params: InsertOrgParams,
  userId: string,
  tokenVersion: number,
): Promise<Organization | null> {
  return getSql().begin(async (tx) => {
    if (!(await lockVerifiedUserForOwnership(tx, userId, tokenVersion))) return null;
    const org = await insertOrganization(params, tx);
    await insertMembership(userId, org.orgId, 'admin', tx);
    return org;
  });
}
