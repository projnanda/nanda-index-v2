import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { getSql, closeSql } from '../../src/db/client.js';

const migration = readFileSync(new URL('../../db/migrations/020_hash_org_verification_tokens.sql', import.meta.url), 'utf8');

describe('organization verification token migration', () => {
  afterAll(closeSql);

  it('invalidates legacy tokens and expiry values while preserving all other organization data', async () => {
    await getSql().begin(async (transaction) => {
      await transaction`CREATE TEMPORARY TABLE organizations (LIKE public.organizations INCLUDING ALL) ON COMMIT DROP`;
      for (const state of ['pending', 'active', 'suspended']) {
        await transaction`
          INSERT INTO organizations (org_id, display_name, contact_email, domain, registry_url,
            identifier, status, email_verified, domain_verified, ever_proven, verify_token, verify_token_expires_at)
          VALUES (${`migration-${state}`}, ${state}, 'migration@example.org', ${`${state}.example.org`},
            'https://cards.example.org/card.json', ${`urn:air:${state}.example.org:catalog:root`},
            ${state}, ${state !== 'pending'}, ${state !== 'pending'}, ${state !== 'pending'},
            ${state === 'active' ? null : 'legacy-plaintext-secret'}, NOW() + INTERVAL '24 hours')`;
      }
      const before = await transaction`SELECT * FROM organizations ORDER BY org_id`;
      await transaction.unsafe(migration);
      const after = await transaction`SELECT * FROM organizations ORDER BY org_id`;
      expect(after).toEqual(before.map((record) => ({ ...record, verifyToken: null, verifyTokenExpiresAt: null })));
      expect(after).toHaveLength(3);
    });
  });
});
