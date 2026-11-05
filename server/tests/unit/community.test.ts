import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCommunityRoutes } from '../../src/routes/community.js';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));
vi.mock('../../src/config/index.js', () => ({ buildConfig: () => ({ email: { smtpUrl: 're_test', fromAddress: 'noreply@nandaindex.org' } }) }));

let app: FastifyInstance;
const payload = {
  name: '  Alice Example  ', email: 'alice@example.org', organization: 'Example Lab',
  interest: 'contribute', working_groups: ['trust-identity'], message: 'I would like to help with identity verification.',
};

beforeEach(async () => {
  send.mockReset().mockResolvedValue({ data: { id: 'email-1' }, error: null });
  app = Fastify();
  await app.register(rateLimit, { global: false });
  await registerCommunityRoutes(app);
  await app.ready();
});
afterEach(async () => { await app.close(); });

describe('community interest submissions', () => {
  it('accepts multibyte messages within the documented character limits', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/community-interest', payload: {
      ...payload, name: '名'.repeat(100), organization: '組'.repeat(100), message: '文'.repeat(4000),
    } });
    expect(response.statusCode).toBe(202);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('delivers the submitted interest to the fixed contact and uses the visitor as reply-to', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/community-interest', payload });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'accepted' });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'vedh@vedhkrishnan.com', from: 'noreply@nandaindex.org', replyTo: 'alice@example.org',
      subject: 'NandaIndex: Contribute',
      text: expect.stringContaining('Name: Alice Example\n'),
    }));
    const email = send.mock.calls[0]![0];
    expect(email.text).toContain('Working groups: Trust and identity');
    expect(email.text).toContain(payload.message);
  });

  it.each([
    { email: 'not-an-email' }, { email: 'alice@example.org\r\nBcc: other@example.org' },
    { name: '   ' }, { interest: 'newsletter' }, { working_groups: ['unknown'] },
    { message: 'x'.repeat(4001) }, { to: 'other@example.org' },
  ])('rejects invalid input before attempting delivery: %j', async (patch) => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/community-interest', payload: { ...payload, ...patch } });
    expect(response.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('reports provider rejection so visitors can retry instead of receiving a false success', async () => {
    send.mockResolvedValue({ data: null, error: { message: 'provider details must not be exposed' } });
    const response = await app.inject({ method: 'POST', url: '/api/v1/community-interest', payload });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: 'DELIVERY_UNAVAILABLE' });
    expect(response.body).not.toContain('provider details');
    expect(response.body).not.toContain('vedh@vedhkrishnan.com');
  });

  it('rejects a filled spam field without sending mail', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/community-interest', payload: { ...payload, website: 'https://spam.example' } });
    expect(response.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('limits repeated submissions from a client', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await app.inject({ method: 'POST', url: '/api/v1/community-interest', payload })).statusCode).toBe(202);
    }
    const limited = await app.inject({ method: 'POST', url: '/api/v1/community-interest', payload });
    expect(limited.statusCode).toBe(429);
    expect(send).toHaveBeenCalledTimes(5);
  });
});
