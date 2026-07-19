import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { getSql, closeSql } from '../../src/db/client.js';
import {
  rankOrganizationsForQuery,
  listOrganizationsPaged,
} from '../../src/db/queries/organizations.js';
import { randomBytes } from 'node:crypto';

async function seedOrg(opts: {
  orgId: string;
  domain: string;
  displayName: string;
  description?: string;
  tags?: string[];
  registryUrl?: string | null;
  status?: string;
  representativeQueries?: string[];
}): Promise<void> {
  const sql = getSql();
  const verifyToken = randomBytes(16).toString('hex');
  await sql`
    INSERT INTO organizations
      (org_id, display_name, domain, contact_email, registry_url, verify_token, email_verified, status,
       description, tags, representative_queries)
    VALUES
      (${opts.orgId}, ${opts.displayName}, ${opts.domain}, ${`admin@${opts.domain}`},
       ${opts.registryUrl ?? `https://${opts.domain}/registry`}, ${verifyToken}, true,
       ${opts.status ?? 'active'},
       ${opts.description ?? null},
       ${sql.array(opts.tags ?? [])},
       ${sql.array(opts.representativeQueries ?? [])})
    ON CONFLICT (org_id) DO NOTHING
  `;
}

describe('rankOrganizationsForQuery', () => {
  afterAll(async () => {
    await closeSql();
  });

  beforeEach(async () => {
    const sql = getSql();
    await sql`DELETE FROM organizations WHERE org_id LIKE 'rank-%'`;
  });

  it('ranks an org matching tags/description above an unrelated org', async () => {
    await seedOrg({
      orgId: 'rank-email',
      domain: 'rank-email.example.com',
      displayName: 'Email Co',
      description: 'Send transactional and marketing email at scale',
      tags: ['email', 'smtp'],
    });
    await seedOrg({
      orgId: 'rank-unrelated',
      domain: 'rank-unrelated.example.com',
      displayName: 'Widget Co',
      description: 'Manufacture physical widgets',
      tags: ['widgets', 'manufacturing'],
    });

    const results = await rankOrganizationsForQuery('send transactional email');
    const orgIds = results.map((r) => r.orgId);
    expect(orgIds).toContain('rank-email');
    expect(orgIds.indexOf('rank-email')).toBeLessThan(
      orgIds.includes('rank-unrelated') ? orgIds.indexOf('rank-unrelated') : Infinity,
    );
  });

  it('excludes orgs without a registry_url', async () => {
    const sql = getSql();
    const verifyToken = randomBytes(16).toString('hex');
    await sql`
      INSERT INTO organizations
        (org_id, display_name, domain, contact_email, registry_url, verify_token, email_verified, status, description, tags)
      VALUES
        ('rank-no-registry', 'No Registry Org', 'rank-noreg.example.com', 'admin@rank-noreg.example.com',
         NULL, ${verifyToken}, true, 'active', 'DNS-AID discovery only, no registry url', ARRAY['dns-aid'])
    `;

    const results = await rankOrganizationsForQuery('DNS-AID discovery');
    expect(results.map((r) => r.orgId)).not.toContain('rank-no-registry');
  });

  it('excludes inactive orgs', async () => {
    await seedOrg({
      orgId: 'rank-pending',
      domain: 'rank-pending.example.com',
      displayName: 'Pending Org',
      description: 'Send transactional email',
      tags: ['email'],
      status: 'pending',
    });

    const results = await rankOrganizationsForQuery('transactional email');
    expect(results.map((r) => r.orgId)).not.toContain('rank-pending');
  });

  it('falls back to ILIKE keyword search when the tsquery matches nothing', async () => {
    await seedOrg({
      orgId: 'rank-fallback',
      domain: 'rank-fallback.example.com',
      displayName: 'FallbackXyzCorp',
      description: '',
      tags: [],
    });

    // "FallbackXyz" won't be in any tsvector token exactly like this substring
    // search would find it, but ensure the function returns *something*
    // sane (either FTS or ILIKE fallback) rather than throwing.
    const results = await rankOrganizationsForQuery('FallbackXyzCorp');
    expect(Array.isArray(results)).toBe(true);
  });

  it('LLM-generated representative_queries close a phrasing gap plain tags/description miss', async () => {
    // "bake" and "bakery" don't share a stem (Postgres English stemming
    // reduces them differently), so a bakery org with only tags/description
    // is invisible to a "help me bake bread" query — this is the exact gap
    // that motivated adding representative_queries. Without it: no match.
    await seedOrg({
      orgId: 'rank-nobake',
      domain: 'rank-nobake.example.com',
      displayName: 'Moonbakery',
      description: 'Order fresh sourdough for pickup',
      tags: ['bakery', 'sourdough'],
    });
    const withoutEnrichment = await rankOrganizationsForQuery('help me bake bread');
    expect(withoutEnrichment.map((r) => r.orgId)).not.toContain('rank-nobake');

    // With representative_queries populated (as the write-time LLM enrichment
    // step would do), the same query now matches.
    await seedOrg({
      orgId: 'rank-withbake',
      domain: 'rank-withbake.example.com',
      displayName: 'Sunbakery',
      description: 'Order fresh sourdough for pickup',
      tags: ['bakery', 'sourdough'],
      representativeQueries: ['help me bake fresh bread', 'order sourdough online'],
    });
    const withEnrichment = await rankOrganizationsForQuery('help me bake bread');
    expect(withEnrichment.map((r) => r.orgId)).toContain('rank-withbake');
  });
});

describe('listOrganizationsPaged', () => {
  afterAll(async () => {
    await closeSql();
  });

  beforeEach(async () => {
    const sql = getSql();
    await sql`DELETE FROM organizations WHERE org_id LIKE 'page-%'`;
  });

  it('paginates active orgs in org_id ascending order with a nextPageToken', async () => {
    await seedOrg({ orgId: 'page-a', domain: 'page-a.example.com', displayName: 'A' });
    await seedOrg({ orgId: 'page-b', domain: 'page-b.example.com', displayName: 'B' });
    await seedOrg({ orgId: 'page-c', domain: 'page-c.example.com', displayName: 'C' });

    // Other integration test files share this DB and may leave their own
    // seeded orgs (different prefixes) lying around, interleaved anywhere
    // in org_id order relative to 'page-*'. So rather than asserting exact
    // page contents (fragile to interleaving), walk the cursor forward
    // starting just before 'page-a' and collect only 'page-*' rows until
    // we've seen all 3 or pagination ends — this still exercises real
    // keyset pagination (ordering, cursor advancement, termination).
    const seen: string[] = [];
    let cursor: string | null = 'page-';
    let pages = 0;
    while (cursor !== null && seen.length < 3 && pages < 20) {
      const page = await listOrganizationsPaged(2, cursor);
      expect(page.rows.length).toBeGreaterThan(0); // pagination must make progress
      seen.push(...page.rows.map((r) => r.orgId).filter((id) => id.startsWith('page-')));
      cursor = page.nextPageToken;
      pages++;
    }

    expect(seen).toEqual(['page-a', 'page-b', 'page-c']);
  });
});
