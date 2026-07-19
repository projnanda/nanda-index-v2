import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { upsertUser } from '../../src/db/queries/users.js';
import { getSql } from '../../src/db/client.js';

const createMock = vi.fn();

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createMock } };
  },
}));

async function makeToken(fastify: FastifyInstance, userId: string, email: string): Promise<string> {
  return fastify.jwt.sign({ userId, email, displayName: null });
}

function mockQueries(queries: string[]): void {
  createMock.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ queries }) } }],
  });
}

describe('Org create/update — LLM enrichment wiring', () => {
  let fastify: FastifyInstance;
  let token: string;
  let userId: string;
  const originalApiKey = process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'sk-test-enrichment';
    const { buildServer } = await import('../../src/server.js');
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();

    const user = await upsertUser({
      email: 'enrichment-test@example.com',
      displayName: 'Enrichment Test',
      avatarUrl: null,
      provider: 'google',
      providerId: 'enrichment-test-provider-id',
    });
    userId = user.id;
    token = await makeToken(fastify, userId, user.email);
  });

  afterAll(async () => {
    await fastify.close();
    const { closeSql } = await import('../../src/db/client.js');
    await closeSql();
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  });

  beforeEach(async () => {
    const sql = getSql();
    await sql`DELETE FROM org_memberships USING organizations
              WHERE org_memberships.org_id = organizations.org_id
              AND organizations.org_id LIKE 'enr-%'`;
    await sql`DELETE FROM organizations WHERE org_id LIKE 'enr-%'`;
  });

  afterEach(() => {
    createMock.mockReset();
  });

  it('populates representative_queries from the LLM on org creation', async () => {
    mockQueries(['help me bake fresh bread', 'order sourdough online']);

    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        org_id: 'enr-bakery',
        display_name: 'Enrichment Bakery',
        domain: 'enr-bakery.example.com',
        contact_email: 'admin@enr-bakery.example.com',
        registry_url: 'https://enr-bakery.example.com/registry',
        description: 'Order fresh sourdough for pickup',
        tags: ['bakery', 'sourdough'],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(res.json().representative_queries).toEqual(['help me bake fresh bread', 'order sourdough online']);
  });

  it('creates the org successfully even when the LLM call fails', async () => {
    createMock.mockRejectedValue(new Error('rate limited'));

    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        org_id: 'enr-resilient',
        display_name: 'Resilient Org',
        domain: 'enr-resilient.example.com',
        contact_email: 'admin@enr-resilient.example.com',
        registry_url: 'https://enr-resilient.example.com/registry',
        description: 'Does something',
        tags: ['x'],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().representative_queries).toBeUndefined();
  });

  it('re-runs enrichment on update when tags change, merging with the current display_name/description', async () => {
    mockQueries(['initial queries']);
    await fastify.inject({
      method: 'POST',
      url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        org_id: 'enr-update',
        display_name: 'Update Org',
        domain: 'enr-update.example.com',
        contact_email: 'admin@enr-update.example.com',
        registry_url: 'https://enr-update.example.com/registry',
        description: 'Original description',
        tags: ['old-tag'],
      },
    });
    createMock.mockClear();
    mockQueries(['updated representative query']);

    const res = await fastify.inject({
      method: 'PUT',
      url: '/api/v1/orgs/enr-update',
      headers: { authorization: `Bearer ${token}` },
      payload: { tags: ['new-tag'] },
    });

    expect(res.statusCode).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(1);
    const promptArg = createMock.mock.calls[0]![0];
    const userMessage = promptArg.messages.find((m: { role: string }) => m.role === 'user').content;
    expect(userMessage).toContain('Update Org'); // merged from current row, not re-supplied
    expect(userMessage).toContain('Original description');
    expect(userMessage).toContain('new-tag');
    expect(res.json().representative_queries).toEqual(['updated representative query']);
  });

  it('does not call the LLM on an update that only touches unrelated fields', async () => {
    mockQueries(['initial queries']);
    await fastify.inject({
      method: 'POST',
      url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        org_id: 'enr-unrelated',
        display_name: 'Unrelated Org',
        domain: 'enr-unrelated.example.com',
        contact_email: 'admin@enr-unrelated.example.com',
        registry_url: 'https://enr-unrelated.example.com/registry',
        description: 'Something',
        tags: ['tag'],
      },
    });
    createMock.mockClear();

    const res = await fastify.inject({
      method: 'PUT',
      url: '/api/v1/orgs/enr-unrelated',
      headers: { authorization: `Bearer ${token}` },
      payload: { registry_url: 'https://enr-unrelated.example.com/new-registry' },
    });

    expect(res.statusCode).toBe(200);
    expect(createMock).not.toHaveBeenCalled();
  });
});
