import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql, closeSql } from '../../src/db/client.js';
import { upsertUser } from '../../src/db/queries/users.js';
import { sendVerificationEmail } from '../../src/services/email.js';
import * as enrichment from '../../src/services/llmEnrichment.js';

vi.mock('../../src/services/email.js', () => ({ sendVerificationEmail: vi.fn().mockResolvedValue(undefined) }));

const A2A = 'application/a2a-agent-card+json';
const MCP = 'application/mcp-server-card+json';
const ORG = 'card-type-correction';
const URL = 'https://example.org/a2a/card';
const a2a = {
  name: '@example', description: 'An example personal agent', version: '1',
  supportedInterfaces: [{ url: 'https://example.org/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
  capabilities: {}, defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'],
  skills: [{ id: 'general', name: 'General', description: 'General tasks', tags: ['general'] }],
};
let app: FastifyInstance;
let ownerToken: string;
let outsiderToken: string;
const headers = () => ({ authorization: `Bearer ${ownerToken}` });
const recordUrl = `/api/v1/orgs/${ORG}`;

beforeAll(async () => {
  app = (await buildServer({ logger: false })).fastify;
  await app.ready();
  for (const who of ['owner', 'outsider']) {
    const user = await upsertUser({ email: `card-type-${who}@example.org`, displayName: who, avatarUrl: null, provider: 'google', providerId: `card-type-${who}`, emailVerified: true });
    const token = app.jwt.sign({ userId: user.id, email: user.email, displayName: null });
    if (who === 'owner') ownerToken = token;
    else outsiderToken = token;
  }
});
afterEach(async () => {
  vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks();
  await getSql()`DELETE FROM organizations WHERE org_id = ${ORG}`;
});
afterAll(async () => { await app.close(); await closeSql(); });

async function create() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(a2a))));
  const response = await app.inject({ method: 'POST', url: '/api/v1/orgs', headers: headers(), payload: {
    org_id: ORG, display_name: 'Example', hosting_path: 'personal', contact_email: 'card-type-agent@example.org',
    registry_url: URL, media_type: MCP,
  } });
  expect(response.statusCode, response.body).toBe(201);
  expect(response.json().card_validation.status).toBe('invalid');
  return response.json();
}

it('corrects a type without resending the URL and preserves identity and verification', async () => {
  const original = await create();
  const token = vi.mocked(sendVerificationEmail).mock.calls[0]![1];
  const verified = await app.inject({ method: 'POST', url: '/api/v1/verify-email', payload: { token } });
  expect(verified.statusCode).toBe(200);
  const response = await app.inject({ method: 'PUT', url: recordUrl, headers: headers(), payload: { media_type: A2A } });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toMatchObject({
    media_type: A2A, registry_url: URL, identifier: original.identifier, status: 'active', email_verified: true,
    email_verified_at: verified.json().email_verified_at, card_validation: { status: 'valid' },
  });
  const publicEntry = await app.inject({ url: `/api/v1/index/${ORG}` });
  expect(publicEntry.json()).toMatchObject({ type: A2A, identifier: original.identifier });
  expect(publicEntry.json().extensions['org.projectnanda'].cardValidation.status).toBe('valid');
});

it('checks the effective new URL and type together without granting verification', async () => {
  await create();
  const response = await app.inject({ method: 'PUT', url: recordUrl, headers: headers(), payload: {
    media_type: A2A, registry_url: 'https://example.org/new-card',
  } });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toMatchObject({ media_type: A2A, registry_url: 'https://example.org/new-card', email_verified: false, status: 'pending', card_validation: { status: 'valid' } });
});

it('keeps a wrong declaration invalid when only its URL is re-saved', async () => {
  await create();
  const response = await app.inject({ method: 'PUT', url: recordUrl, headers: headers(), payload: { registry_url: URL } });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ media_type: MCP, card_validation: { status: 'invalid' } });
});

it('requires administrator access before correcting the card type or fetching it', async () => {
  await create();
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const response = await app.inject({ method: 'PUT', url: recordUrl, headers: { authorization: `Bearer ${outsiderToken}` }, payload: { media_type: A2A } });
  expect(response.statusCode).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['application/ai-catalog+json', 'application/ai-registry+json', 'application/agentskill+zip', 'a2a'])(
  'refuses an unsupported type correction to %s', async (media_type) => {
    await create();
    const response = await app.inject({ method: 'PUT', url: recordUrl, headers: headers(), payload: { media_type } });
    expect(response.statusCode).toBe(400);
    const record = await app.inject({ url: recordUrl, headers: headers() });
    expect(record.json().media_type).toBe(MCP);
  },
);

it('does not convert a catalog registration into an agent card', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  const created = await app.inject({ method: 'POST', url: '/api/v1/orgs', headers: headers(), payload: {
    org_id: ORG, display_name: 'Catalog', hosting_path: 'registry', domain: 'card-type.example.org',
    contact_email: 'catalog@card-type.example.org', registry_url: URL,
  } });
  expect(created.statusCode, created.body).toBe(201);
  const response = await app.inject({ method: 'PUT', url: recordUrl, headers: headers(), payload: { media_type: A2A } });
  expect(response.statusCode).toBe(400);
  expect(response.json().detail).toContain('A2A and MCP');
});

it('persists the new type with an invalid check if required card fields are missing', async () => {
  await create();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...a2a, capabilities: undefined }))));
  const response = await app.inject({ method: 'PUT', url: recordUrl, headers: headers(), payload: { media_type: A2A } });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ media_type: A2A, card_validation: { status: 'invalid', detail: expect.stringContaining('capabilities') } });
});

it('does not store validation for a card URL changed while the check was running', async () => {
  await create();
  let start!: () => void;
  let finish!: (response: Response) => void;
  const started = new Promise<void>((resolve) => { start = resolve; });
  const pendingCard = new Promise<Response>((resolve) => { finish = resolve; });
  vi.stubGlobal('fetch', vi.fn(() => { start(); return pendingCard; }));
  const pendingUpdate = app.inject({ method: 'PUT', url: recordUrl, headers: headers(), payload: { registry_url: URL } }).then((response) => response);
  await started;
  await getSql()`UPDATE organizations SET registry_url = 'https://example.org/concurrent-card' WHERE org_id = ${ORG}`;
  finish(new Response(JSON.stringify(a2a)));
  const response = await pendingUpdate;
  expect(response.statusCode).toBe(409);
  expect(response.json().error).toBe('CARD_CHANGED');
  const [record] = await getSql()`SELECT registry_url, media_type FROM organizations WHERE org_id = ${ORG}`;
  expect(record).toMatchObject({ registryUrl: 'https://example.org/concurrent-card', mediaType: MCP });
});

it('does not let a concurrent metadata edit undo a type correction', async () => {
  await create();
  let start!: () => void;
  let finish!: () => void;
  const started = new Promise<void>((resolve) => { start = resolve; });
  const pendingEnrichment = new Promise<void>((resolve) => { finish = resolve; });
  vi.spyOn(enrichment, 'generateRepresentativeQueries').mockImplementationOnce(async () => { start(); await pendingEnrichment; return []; });
  const metadataUpdate = app.inject({ method: 'PUT', url: recordUrl, headers: headers(), payload: { display_name: 'New name' } }).then((response) => response);
  await started;
  const correction = await app.inject({ method: 'PUT', url: recordUrl, headers: headers(), payload: { media_type: A2A } });
  finish();
  const metadata = await metadataUpdate;
  expect(correction.statusCode).toBe(200);
  expect(metadata.statusCode).toBe(200);
  const record = await app.inject({ url: recordUrl, headers: headers() });
  expect(record.json()).toMatchObject({ display_name: 'New name', media_type: A2A, card_validation: { status: 'valid' } });
});

it.each([
  { domain: 'card-type-new.example.org' },
  { publisher: { displayName: 'Updated publisher' } },
  { extensions: { 'org.projectnanda': { note: 'Updated extension' } } },
])('does not overwrite a profile update made during card validation: %j', async (profileUpdate) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(a2a))));
  const created = await app.inject({ method: 'POST', url: '/api/v1/orgs', headers: headers(), payload: {
    org_id: ORG, display_name: 'Example', hosting_path: 'dns-svcb', domain: 'card-type-old.example.org',
    contact_email: 'card-type-agent@example.org', registry_url: URL, media_type: MCP,
  } });
  expect(created.statusCode, created.body).toBe(201);
  await getSql()`UPDATE organizations SET email_verified = true, email_verified_at = NOW(),
    domain_verified = true, domain_verified_at = NOW(), status = 'active' WHERE org_id = ${ORG}`;
  let start!: () => void;
  let finish!: (response: Response) => void;
  const started = new Promise<void>((resolve) => { start = resolve; });
  const pendingCard = new Promise<Response>((resolve) => { finish = resolve; });
  vi.stubGlobal('fetch', vi.fn(() => { start(); return pendingCard; }));
  const pendingUpdate = app.inject({ method: 'PUT', url: recordUrl, headers: headers(), payload: { media_type: A2A } }).then((response) => response);
  await started;
  const concurrent = await app.inject({ method: 'PUT', url: recordUrl, headers: headers(), payload: profileUpdate });
  finish(new Response(JSON.stringify(a2a)));
  const correction = await pendingUpdate;
  expect(concurrent.statusCode, concurrent.body).toBe(200);
  expect(correction.statusCode, correction.body).toBe(409);
  expect(correction.json().error).toBe('CARD_CHANGED');
  const record = await app.inject({ url: recordUrl, headers: headers() });
  expect(record.json()).toEqual(concurrent.json());
});
