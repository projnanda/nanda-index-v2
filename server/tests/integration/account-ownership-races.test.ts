import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql, closeSql } from '../../src/db/client.js';
import { createUserWithPassword } from '../../src/db/queries/users.js';
import { createPasswordHasher } from '../../src/lib/password.js';
import * as memberships from '../../src/db/queries/orgMemberships.js';
import * as enrichment from '../../src/services/llmEnrichment.js';

vi.mock('../../src/services/email.js', async (original) => ({
  ...(await original<typeof import('../../src/services/email.js')>()),
  sendVerificationEmail: vi.fn(),
}));

const password = 'ownership-race-password';
let app: FastifyInstance;
let passwordHash: string;
let sequence = 0;
const sql = () => getSql();

function gate() {
  let reached!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { reached, release, waiting, resume };
}

async function owner() {
  const orgId = `account-ownership-${++sequence}`;
  const email = `${orgId}@example.com`;
  const user = await createUserWithPassword(email, passwordHash, 'Owner');
  await sql()`UPDATE users SET email_verified = true WHERE id = ${user.id}`;
  const token = app.jwt.sign({ userId: user.id, email, displayName: 'Owner', tokenVersion: 0 });
  const headers = { authorization: `Bearer ${token}` };
  return {
    user,
    orgId,
    headers,
    register: () =>
      app
        .inject({
          method: 'POST',
          url: '/api/v1/orgs',
          headers,
          payload: {
            org_id: orgId,
            display_name: 'Race entry',
            domain: `${orgId}.example.com`,
            contact_email: email,
            registry_url: 'https://example.com/catalog.json',
          },
        })
        .then((response) => response),
    remove: () =>
      app
        .inject({
          method: 'DELETE',
          url: '/api/v1/me',
          headers,
          payload: { confirmation: 'DELETE', current_password: password },
        })
        .then((response) => response),
  };
}

beforeAll(async () => {
  passwordHash = await createPasswordHasher(1).hash(password);
  app = (await buildServer({ logger: false })).fastify;
  await app.ready();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await sql()`DELETE FROM organizations WHERE org_id LIKE 'account-ownership-%'`;
  await sql()`DELETE FROM users WHERE email LIKE 'account-ownership-%'`;
});
afterAll(async () => {
  vi.restoreAllMocks();
  await app.close();
  await closeSql();
});

describe('registration versus account security changes', () => {
  it('commits an entry with its administrator and makes a waiting deletion see the blocker', async () => {
    const account = await owner();
    const paused = gate();
    const insert = memberships.insertMembership;
    vi.spyOn(memberships, 'insertMembership').mockImplementationOnce(async (...args) => {
      paused.reached();
      await paused.resume;
      return insert(...args);
    });
    const registration = account.register();
    let deletion: ReturnType<typeof account.remove> | undefined;
    try {
      await paused.waiting;
      const visibleBeforeMembership =
        await sql()`SELECT org_id FROM organizations WHERE org_id = ${account.orgId}`;
      let deletionFinished = false;
      deletion = account.remove().then((response) => {
        deletionFinished = true;
        return response;
      });
      // Observe the actual database wait, rather than sleeping and hoping the
      // delete reached the account lock. The old implementation finishes here.
      await vi.waitFor(
        async () => {
          const waiting = await sql()`SELECT pid FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%users%FOR UPDATE%'`;
          expect(deletionFinished || waiting.length > 0).toBe(true);
        },
        { timeout: 3000, interval: 10 },
      );
      paused.release();
      const [created, deleted] = await Promise.all([registration, deletion]);
      const orphan =
        await sql()`SELECT o.org_id FROM organizations o WHERE o.org_id = ${account.orgId}
        AND NOT EXISTS (SELECT 1 FROM org_memberships m WHERE m.org_id = o.org_id AND m.role = 'admin')`;
      expect({
        registration: created.statusCode,
        deletion: deleted.statusCode,
        orphanCount: orphan.length,
      }).toEqual({ registration: 201, deletion: 409, orphanCount: 0 });
      expect(visibleBeforeMembership).toHaveLength(0);
    } finally {
      paused.release();
      await Promise.allSettled([registration, ...(deletion ? [deletion] : [])]);
    }
  });

  it.each(['delete', 'logout'] as const)(
    'rejects a registration after account %s wins during preparation',
    async (action) => {
      const account = await owner();
      const paused = gate();
      vi.spyOn(enrichment, 'generateRepresentativeQueries').mockImplementationOnce(async () => {
        paused.reached();
        await paused.resume;
        return [];
      });
      const registration = account.register();
      try {
        await paused.waiting;
        const changed =
          action === 'delete'
            ? await account.remove()
            : await app.inject({
                method: 'POST',
                url: '/auth/logout-all',
                headers: account.headers,
              });
        expect(changed.statusCode).toBe(action === 'delete' ? 204 : 200);
        paused.release();
        expect((await registration).statusCode).toBe(401);
        expect(
          await sql()`SELECT org_id FROM organizations WHERE org_id = ${account.orgId}`,
        ).toHaveLength(0);
      } finally {
        paused.release();
        await registration;
      }
    },
  );

  it('rolls back the entry if granting its administrator fails', async () => {
    const account = await owner();
    vi.spyOn(memberships, 'insertMembership').mockRejectedValueOnce(
      new Error('simulated membership failure'),
    );
    expect((await account.register()).statusCode).toBe(500);
    expect(
      await sql()`SELECT org_id FROM organizations WHERE org_id = ${account.orgId}`,
    ).toHaveLength(0);
  });
});
