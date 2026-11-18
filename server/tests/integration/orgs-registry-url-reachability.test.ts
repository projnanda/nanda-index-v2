import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql, closeSql } from '../../src/db/client.js';
import { upsertUser } from '../../src/db/queries/users.js';

/**
 * The index publishes registry_url to every consumer, so a private or
 * loopback address here is an instruction to other people's software to
 * fetch their own internal network. The outbound guard already recognised
 * these addresses; it was simply never asked on the write path.
 */
describe('registry_url must be a public address', () => {
  let fastify: FastifyInstance;
  let token: string;
  const orgId = 'reachability-test';
  const privateHosts = process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'];

  const create = (registryUrl: string, id = orgId) => fastify.inject({
    method: 'POST', url: '/api/v1/orgs',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      org_id: id, display_name: 'Reachability', domain: `${id}.example.com`,
      contact_email: 'reachability@example.com', registry_url: registryUrl,
    },
  });

  beforeAll(async () => {
    ({ fastify } = await buildServer({ logger: false }));
    await fastify.ready();
    const user = await upsertUser({
      email: 'reachability@example.com', displayName: null, avatarUrl: null,
      provider: 'google', providerId: 'reachability-provider', emailVerified: true,
    });
    token = fastify.jwt.sign({ userId: user.id, email: user.email, displayName: null });
  });

  beforeEach(async () => {
    await getSql()`DELETE FROM organizations WHERE org_id LIKE 'reachability%'`;
    process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'] = 'false';
  });

  afterAll(async () => {
    if (privateHosts === undefined) delete process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'];
    else process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'] = privateHosts;
    await getSql()`DELETE FROM organizations WHERE org_id LIKE 'reachability%'`;
    await fastify.close();
    await closeSql();
  });

  it.each([
    { label: 'IPv4 loopback', value: 'https://127.0.0.1:5433/catalog.json' },
    { label: 'IPv6 loopback', value: 'https://[::1]/catalog.json' },
    { label: 'private 10.x', value: 'https://10.0.0.1/catalog.json' },
    { label: 'private 192.168.x', value: 'https://192.168.1.1/catalog.json' },
    { label: 'link-local metadata', value: 'https://169.254.169.254/latest/meta-data/' },
  ])('refuses $label on create, so it is never published', async ({ value }) => {
    const res = await create(value);

    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain('public internet address');
    expect(await getSql()`SELECT 1 FROM organizations WHERE org_id = ${orgId}`).toHaveLength(0);
  });

  it.each([
    { label: 'cloud metadata by name', value: 'https://metadata.google.internal/computeMetadata/v1/' },
    { label: 'localhost by name', value: 'https://localhost:5433/catalog.json' },
    { label: 'a .local mDNS name', value: 'https://printer.local/catalog.json' },
    { label: 'a .internal name', value: 'https://db.svc.internal/catalog.json' },
    { label: 'a .home.arpa name', value: 'https://nas.home.arpa/catalog.json' },
  ])('refuses $label even when it does not resolve here', async ({ value }) => {
    // Resolution depends on who asks. metadata.google.internal does not
    // resolve from outside GCP, and points at 169.254.169.254 for every
    // consumer that runs there — so the address check alone would publish it.
    const res = await create(value);

    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain('public internet address');
  });

  it.each([
    { label: 'a bare single-label name', value: 'https://metadata/computeMetadata/v1/' },
    { label: 'the EC2 short name', value: 'https://instance-data/latest/' },
    { label: 'a .lan name', value: 'https://router.lan/catalog.json' },
    { label: 'a .corp name', value: 'https://intranet.corp/catalog.json' },
    { label: 'a .home name', value: 'https://hub.home/catalog.json' },
    { label: 'a .intranet name', value: 'https://wiki.intranet/catalog.json' },
    { label: 'trailing dots on localhost', value: 'https://localhost../catalog.json' },
  ])('refuses $label', async ({ value }) => {
    // A name with no dot resolves only through a search domain, so it names
    // something inside one network: `metadata` reaches 169.254.169.254 on GCE
    // and `instance-data` reaches it on EC2.
    const res = await create(value);

    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain('public internet address');
  });

  it('still accepts an IPv6 literal that is publicly routable', async () => {
    // IPv6 literals have no dots; they must be judged by address, not by shape.
    expect((await create('https://[2606:4700:4700::1111]/catalog.json')).statusCode).toBe(201);
  });

  it('accepts a hostname that does not resolve yet', async () => {
    // Registering before DNS exists is ordinary: a new domain, a staged
    // launch, a propagation window. Refusing it would also make every
    // registration fail whenever DNS is slow, and the risk this guard exists
    // for needs the host to really resolve to a private address.
    const res = await create('https://no-such-host.invalid/catalog.json');

    expect(res.statusCode).toBe(201);
  });

  it('allows a private address when OUTBOUND_ALLOW_PRIVATE_HOSTS is on', async () => {
    // Local development registers against a registry on localhost.
    process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'] = 'true';

    expect((await create('https://127.0.0.1:5433/catalog.json')).statusCode).toBe(201);
  });

  it('refuses a change to a private address on update', async () => {
    process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'] = 'true';
    expect((await create('https://example.com/catalog.json')).statusCode).toBe(201);
    process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'] = 'false';

    const res = await fastify.inject({
      method: 'PUT', url: `/api/v1/orgs/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { registry_url: 'https://127.0.0.1:5433/moved.json' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain('public internet address');
  });

  it('leaves an entry whose stored URL is already private editable', async () => {
    // Registered before this rule existed. Its owner must still be able to
    // edit other fields; tightening that is a separate migration problem.
    process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'] = 'true';
    expect((await create('https://127.0.0.1:5433/catalog.json')).statusCode).toBe(201);
    process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'] = 'false';

    const res = await fastify.inject({
      method: 'PUT', url: `/api/v1/orgs/${orgId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { description: 'Edited without touching the URL' },
    });

    expect(res.statusCode).toBe(200);
  });
});
