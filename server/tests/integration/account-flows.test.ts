import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';
import { upsertUser } from '../../src/db/queries/users.js';
import { captureOrgVerificationEmails } from '../helpers/orgVerificationEmails.js';

/**
 * Account flows the external test found broken: editing a personal entry,
 * the DNS challenge surviving a reload, verification links eaten by mail
 * scanners (and no resend), and case-sensitive email login.
 */

const PREFIX = 'af-';

describe('account flows', () => {
  let fastify: FastifyInstance;
  let token: string;
  let emails: ReturnType<typeof captureOrgVerificationEmails>;

  const auth = () => ({ authorization: `Bearer ${token}` });
  const createPersonal = (orgId: string, email: string) => fastify.inject({
    method: 'POST', url: '/api/v1/orgs', headers: auth(),
    payload: {
      org_id: orgId, display_name: 'Personal', hosting_path: 'personal',
      contact_email: email, registry_url: 'https://agentcards.host39.org/p.json',
    },
  });
  const createDomain = (orgId: string, domain: string) => fastify.inject({
    method: 'POST', url: '/api/v1/orgs', headers: auth(),
    payload: {
      org_id: orgId, display_name: 'Domain', hosting_path: 'registry', domain,
      contact_email: `a@${domain}`, registry_url: `https://${domain}/r`,
    },
  });
  const verifyToken = async (orgId: string): Promise<string> => {
    return emails.tokenFor(orgId);
  };

  beforeAll(async () => {
    emails = captureOrgVerificationEmails();
    fastify = (await buildServer({ logger: false })).fastify;
    await fastify.ready();
    const user = await upsertUser({
      email: 'af-owner@example.com', displayName: 'Owner', avatarUrl: null, provider: 'google', providerId: 'af-owner',
    });
    token = fastify.jwt.sign({ userId: user.id, email: user.email, displayName: null });
  });

  afterAll(async () => {
    emails.restore();
    await fastify.close();
    const { closeSql } = await import('../../src/db/client.js');
    await closeSql();
  });

  beforeEach(async () => {
    const sql = getSql();
    await sql`DELETE FROM org_memberships WHERE org_id LIKE ${`${PREFIX}%`}`;
    await sql`DELETE FROM organizations WHERE org_id LIKE ${`${PREFIX}%`}`;
    await sql`DELETE FROM users WHERE lower(email) LIKE 'af-login%'`;
  });

  // ── #4 editing a personal entry ──────────────────────────────────────────────

  it('saves a personal entry when the form sends an empty domain', async () => {
    await createPersonal(`${PREFIX}edit`, 'af-edit@example.org');

    const res = await fastify.inject({
      method: 'PUT', url: `/api/v1/orgs/${PREFIX}edit`, headers: auth(),
      payload: { display_name: 'Renamed', domain: '' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().display_name).toBe('Renamed');
    expect(res.json().domain).toBeNull();
  });

  it('still refuses to give a personal entry a real domain', async () => {
    await createPersonal(`${PREFIX}edit2`, 'af-edit2@example.org');

    const res = await fastify.inject({
      method: 'PUT', url: `/api/v1/orgs/${PREFIX}edit2`, headers: auth(),
      payload: { domain: 'example.com' },
    });

    expect(res.statusCode).toBe(400);
  });

  // ── #9 the DNS challenge survives a reload ───────────────────────────────────

  // The dashboard panel requests the challenge on load; #27 makes that request
  // return the record already issued, so a reload never invalidates what the
  // admin has published in DNS.
  it('returns the same DNS record when the panel reloads', async () => {
    await createDomain(`${PREFIX}dns`, 'af-dns.example.com');
    const issue = () => fastify.inject({
      method: 'POST', url: `/api/v1/orgs/${PREFIX}dns/domain-challenge`, headers: auth(),
    });
    const first = (await issue()).json();

    const reloaded = await issue();

    expect(reloaded.statusCode).toBe(200);
    expect(reloaded.json()).toMatchObject({
      record_name: '_nanda-challenge.af-dns.example.com',
      record_value: first.record_value,
      expires_at: first.expires_at,
    });
  });

  it('refuses a DNS challenge for a personal entry', async () => {
    await createPersonal(`${PREFIX}nodns`, 'af-nodns@example.org');

    const res = await fastify.inject({
      method: 'POST', url: `/api/v1/orgs/${PREFIX}nodns/domain-challenge`, headers: auth(),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('NO_DOMAIN');
  });

  // ── #3 verification survives link scanners; resend exists ───────────────────

  it('emails a link to the web app, not to the API', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createPersonal(`${PREFIX}link`, 'af-link@example.org');
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes('verification link'));
    log.mockRestore();

    expect(line).toContain('/verify-email?token=');
    expect(line).not.toContain('/api/v1/verify-email');
  });

  it('does not consume the token when the old GET link is opened (e.g. by a mail scanner)', async () => {
    await createPersonal(`${PREFIX}scan`, 'af-scan@example.org');
    const t = await verifyToken(`${PREFIX}scan`);

    const res = await fastify.inject({ method: 'GET', url: `/api/v1/verify-email?token=${t}` });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain(`/verify-email?token=${t}`);
    expect(await verifyToken(`${PREFIX}scan`)).toBe(t);
    expect((await fastify.inject({ method: 'POST', url: '/api/v1/verify-email', payload: { token: t } })).statusCode).toBe(200);
  });

  it('verifies with an explicit POST from the web page', async () => {
    await createPersonal(`${PREFIX}post`, 'af-post@example.org');
    const t = await verifyToken(`${PREFIX}post`);

    const res = await fastify.inject({ method: 'POST', url: '/api/v1/verify-email', payload: { token: t } });

    expect(res.statusCode).toBe(200);
    expect(res.json().email_verified).toBe(true);
  });

  /** Pretend the registration email went out an hour ago (past the resend cooldown). */
  const sentAnHourAgo = (orgId: string) => getSql()`
    UPDATE organizations SET verify_token_expires_at = NOW() + INTERVAL '23 hours' WHERE org_id = ${orgId}`;

  it('resends the verification email with a fresh token', async () => {
    await createPersonal(`${PREFIX}resend`, 'af-resend@example.org');
    await sentAnHourAgo(`${PREFIX}resend`);
    const before = await verifyToken(`${PREFIX}resend`);

    const res = await fastify.inject({
      method: 'POST', url: `/api/v1/orgs/${PREFIX}resend/resend-verification`, headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    expect(await verifyToken(`${PREFIX}resend`)).not.toBe(before);
  });

  it('refuses a second resend within the cooldown, so it cannot be used to flood an inbox', async () => {
    await createPersonal(`${PREFIX}flood`, 'af-flood@example.org');
    await sentAnHourAgo(`${PREFIX}flood`);
    const resend = () => fastify.inject({
      method: 'POST', url: `/api/v1/orgs/${PREFIX}flood/resend-verification`, headers: auth(),
    });

    expect((await resend()).statusCode).toBe(200);
    const second = await resend();

    expect(second.statusCode).toBe(429);
    expect(second.json().error).toBe('RESEND_COOLDOWN');
  });

  it('does not resend once the email is verified', async () => {
    await createPersonal(`${PREFIX}done`, 'af-done@example.org');
    await fastify.inject({ method: 'POST', url: '/api/v1/verify-email', payload: { token: await verifyToken(`${PREFIX}done`) } });

    const res = await fastify.inject({
      method: 'POST', url: `/api/v1/orgs/${PREFIX}done/resend-verification`, headers: auth(),
    });

    expect(res.statusCode).toBe(409);
  });

  // ── #10 email is case-insensitive ────────────────────────────────────────────

  it('logs in with a differently-cased email', async () => {
    const reg = await fastify.inject({
      method: 'POST', url: '/auth/register',
      payload: { email: 'af-Login@Example.com', password: 'correct-horse-battery' },
    });
    expect(reg.statusCode).toBe(201);

    const res = await fastify.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'AF-LOGIN@example.COM', password: 'correct-horse-battery' },
    });

    expect(res.statusCode).toBe(200);
  });

  it('refuses a second account that differs only in case', async () => {
    await fastify.inject({
      method: 'POST', url: '/auth/register',
      payload: { email: 'af-login2@example.com', password: 'correct-horse-battery' },
    });

    const res = await fastify.inject({
      method: 'POST', url: '/auth/register',
      payload: { email: 'AF-Login2@Example.com', password: 'correct-horse-battery' },
    });

    expect(res.statusCode).toBe(409);
  });
});
