import { describe, it, expect } from 'vitest';
import {
  LOGGABLE_QUERY_PARAMS,
  MAX_LOGGED_URL_CHARS,
  REDACTED,
  redactUrl,
  serializeRequest,
} from '../../src/lib/logRedaction.js';

/**
 * These tests are written to fail when someone adds the *next* credential to a
 * query string, not only to cover the two that prompted the change. The
 * fail-safe cases below are the point of the suite: an unknown parameter is
 * masked without anyone editing this file or the allowlist.
 */
describe('redactUrl', () => {
  it('leaves a URL with no query string alone', () => {
    expect(redactUrl('/api/v1/index')).toBe('/api/v1/index');
  });

  it('leaves a bare trailing question mark alone', () => {
    expect(redactUrl('/api/v1/index?')).toBe('/api/v1/index?');
  });

  it('masks the org verification token', () => {
    expect(redactUrl('/api/v1/verify-email?token=abc123SECRET')).toBe(
      `/api/v1/verify-email?token=${REDACTED}`,
    );
  });

  it('masks an OAuth authorization code and state', () => {
    expect(redactUrl('/auth/github/callback?code=4/0ASECRET&state=xyz')).toBe(
      `/auth/github/callback?code=${REDACTED}&state=${REDACTED}`,
    );
  });

  it('masks a parameter nobody has thought of yet', () => {
    // The fail-safe case. No allowlist edit, no denylist entry: a parameter
    // added by a future route is masked because it is not named as loggable.
    expect(redactUrl('/api/v1/anything?recoveryCode=SECRET')).toBe(
      `/api/v1/anything?recoveryCode=${REDACTED}`,
    );
  });

  it('masks a parameter whose name differs from the allowlist only by case', () => {
    expect(redactUrl('/api/v1/search?Q=secret')).toBe(`/api/v1/search?Q=${REDACTED}`);
    expect(redactUrl('/api/v1/verify-email?TOKEN=secret')).toBe(
      `/api/v1/verify-email?TOKEN=${REDACTED}`,
    );
  });

  it('masks an empty value, so the parameter name alone cannot confirm a probe', () => {
    expect(redactUrl('/api/v1/verify-email?token=')).toBe(
      `/api/v1/verify-email?token=${REDACTED}`,
    );
  });

  it('masks every occurrence when a secret parameter is repeated', () => {
    expect(redactUrl('/x?token=one&token=two')).toBe(
      `/x?token=${REDACTED}&token=${REDACTED}`,
    );
  });

  it('masks a secret that is not the first parameter', () => {
    expect(redactUrl('/api/v1/search?q=wine&token=SECRET&limit=5')).toBe(
      `/api/v1/search?q=wine&token=${REDACTED}&limit=5`,
    );
  });

  it('keeps the value of every parameter on the allowlist', () => {
    for (const param of LOGGABLE_QUERY_PARAMS) {
      expect(redactUrl(`/x?${param}=kept`)).toBe(`/x?${param}=kept`);
    }
  });

  it('has nothing credential-shaped on the allowlist', () => {
    // Guards the list itself. Adding a route whose query string carries a
    // secret is fine — it gets masked. Adding that parameter to the allowlist
    // so it shows up in the log is the mistake, and this fails on it.
    //
    // The match is deliberately a substring, so `verifyToken` or `resetCode`
    // trips it too. A name that only looks credential-shaped has to be
    // exempted below, with a reason — the default answer for anything
    // token-shaped is that it does not belong in a log.
    const notActuallyCredentials = new Set([
      // ard.ts pagination cursor. It is the last org_id of the previous page
      // (db/queries/organizations.ts:815) — a public identifier that appears
      // in the response body anyway.
      'pageToken',
    ]);
    const credentialish = [
      'token',
      'code',
      'state',
      'secret',
      'password',
      'passwd',
      'key',
      'apikey',
      'api_key',
      'auth',
      'authorization',
      'session',
      'jwt',
      'signature',
      'sig',
      'nonce',
      'otp',
      'credential',
      'challenge',
      'proof',
    ];
    const offenders = LOGGABLE_QUERY_PARAMS.filter(
      (param) =>
        !notActuallyCredentials.has(param) &&
        credentialish.some((word) => param.toLowerCase().includes(word)),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps the path byte for byte', () => {
    const path = '/api/v1/orgs/My-Org.123~a/domain-challenge';
    expect(redactUrl(`${path}?token=s`)).toBe(`${path}?token=${REDACTED}`);
  });

  it('does not percent-decode or otherwise rewrite a value it keeps', () => {
    // A log that normalises the URL no longer shows what was requested, and
    // decoding hostile input to re-encode it is work with nothing to gain.
    const url = '/api/v1/search?q=a+b%2Fc%20d&locator=urn%3Aair%3Ax.com%3Aagent%3Ay';
    expect(redactUrl(url)).toBe(url);
  });

  it('keeps a parameter that carries no value', () => {
    expect(redactUrl('/x?token')).toBe('/x?token');
  });

  it('does not throw or leak on a malformed query string', () => {
    expect(redactUrl('/x?&=&')).toBe(`/x?&=${REDACTED}&`);
    expect(redactUrl('/x?=SECRET')).toBe(`/x?=${REDACTED}`);
    expect(redactUrl('/x?=')).toBe(`/x?=${REDACTED}`);
  });

  it('truncates a URL long enough to bloat the log, and marks that it did', () => {
    const long = `/api/v1/search?q=${'a'.repeat(MAX_LOGGED_URL_CHARS * 2)}`;
    const out = redactUrl(long);
    expect(out.length).toBe(MAX_LOGGED_URL_CHARS + 1);
    expect(out.endsWith('…')).toBe(true);
  });

  it('truncates an oversized path even with no query string', () => {
    const out = redactUrl(`/${'a'.repeat(MAX_LOGGED_URL_CHARS * 2)}`);
    expect(out.length).toBe(MAX_LOGGED_URL_CHARS + 1);
  });

  it('never emits a secret it was asked to truncate', () => {
    // Truncation happens after masking, so a secret beyond the cap cannot
    // survive by being cut off mid-value.
    const out = redactUrl(`/x?pad=${'a'.repeat(MAX_LOGGED_URL_CHARS)}&token=SECRET`);
    expect(out).not.toContain('SECRET');
  });
});

describe('serializeRequest', () => {
  const request = {
    method: 'GET',
    url: '/api/v1/verify-email?token=SECRET',
    host: 'api.nandaindex.org',
    socket: { remoteAddress: '203.0.113.7', remotePort: 54321 },
  };

  it('emits the same fields as Fastify’s default serializer, with the URL redacted', () => {
    // The field set is load-bearing: log consumers read these names.
    expect(serializeRequest(request as never)).toEqual({
      method: 'GET',
      url: `/api/v1/verify-email?token=${REDACTED}`,
      host: 'api.nandaindex.org',
      remoteAddress: '203.0.113.7',
      remotePort: 54321,
    });
  });

  it('survives a request with no socket', () => {
    const { socket: _socket, ...noSocket } = request;
    expect(serializeRequest(noSocket as never)).toMatchObject({
      remoteAddress: undefined,
      remotePort: undefined,
    });
  });
});
