import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';

/**
 * End-to-end proof that no query-string credential reaches the log, asserted
 * against what the logger actually writes rather than against the redaction
 * helper. This is the test that fails if the serializer is ever dropped from
 * buildServer, if a plugin replaces it, or if a future Fastify version logs
 * the URL somewhere else as well.
 *
 * Requires Docker Postgres up, like the other integration suites.
 */
describe('request log redaction', () => {
  let fastify: FastifyInstance;
  let written: string;
  const lines: string[] = [];

  const sink = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });

  beforeAll(async () => {
    const built = await buildServer({ logger: { stream: sink } });
    fastify = built.fastify;
    await fastify.ready();

    // Every route that takes a credential in a query string, plus one that
    // takes a value worth keeping.
    await fastify.inject({
      method: 'GET',
      url: '/api/v1/verify-email?token=CANARY_ORG_VERIFICATION_TOKEN',
    });
    await fastify.inject({
      method: 'GET',
      url: '/auth/github/callback?code=CANARY_OAUTH_CODE&state=CANARY_OAUTH_STATE',
    });
    await fastify.inject({
      method: 'GET',
      url: '/auth/google/callback?code=CANARY_GOOGLE_CODE',
    });
    await fastify.inject({ method: 'GET', url: '/api/v1/search?q=CANARY_SEARCH_TERM' });

    written = lines.join('');
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('wrote something, so the assertions below are meaningful', () => {
    // Without this an empty log would make every "not.toContain" pass.
    expect(written).toContain('incoming request');
    expect(written).toContain('/api/v1/verify-email');
  });

  it('never writes the org verification token', () => {
    expect(written).not.toContain('CANARY_ORG_VERIFICATION_TOKEN');
    expect(written).toContain('token=[redacted]');
  });

  it('never writes an OAuth authorization code from either provider', () => {
    expect(written).not.toContain('CANARY_OAUTH_CODE');
    expect(written).not.toContain('CANARY_GOOGLE_CODE');
    expect(written).toContain('code=[redacted]');
  });

  it('never writes the OAuth state parameter', () => {
    expect(written).not.toContain('CANARY_OAUTH_STATE');
  });

  it('still writes the search term, so the log stays useful', () => {
    // Redaction that hides what a request asked for would trade one problem
    // for another; the allowlist exists so this keeps working.
    expect(written).toContain('q=CANARY_SEARCH_TERM');
  });

  it('cannot be defeated by an operator supplying their own serializer', async () => {
    // A caller passing logger options must not be able to reinstate the
    // default url-in-full serializer.
    const hostile = await buildServerLoggerKeepsRedaction({
      serializers: { req: (r: { url: string }) => r },
    });
    expect(hostile).toContain('/api/v1/verify-email');
    expect(hostile).not.toContain('CANARY_OVERRIDE');
  });
});

/** Builds a server with hostile logger options and returns what it logged. */
async function buildServerLoggerKeepsRedaction(loggerOptions: object): Promise<string> {
  const captured: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      captured.push(String(chunk));
      callback();
    },
  });
  const { fastify } = await buildServer({ logger: { ...loggerOptions, stream } });
  await fastify.ready();
  await fastify.inject({ method: 'GET', url: '/api/v1/verify-email?token=CANARY_OVERRIDE' });
  await fastify.close();
  return captured.join('');
}
