import { describe, it, expect } from 'vitest';
import {
  challengeRecordName,
  challengeRecordValue,
  lookupDomainToken,
  CHALLENGE_PREFIX,
  VALUE_PREFIX,
  type TxtResolver,
} from '../../src/services/domainVerification.js';

describe('domainVerification — record construction', () => {
  it('builds the challenge record name under the _nanda-challenge label', () => {
    expect(challengeRecordName('acme.com')).toBe(`${CHALLENGE_PREFIX}.acme.com`);
    expect(challengeRecordName('sub.acme.com')).toBe(`${CHALLENGE_PREFIX}.sub.acme.com`);
  });

  it('builds the namespaced TXT value from a token', () => {
    expect(challengeRecordValue('abc123')).toBe(`${VALUE_PREFIX}abc123`);
  });
});

describe('domainVerification — lookupDomainToken', () => {
  const domain = 'acme.com';
  const token = 'deadbeef';
  const expected = challengeRecordValue(token);

  it('verifies when the expected value is present', async () => {
    const resolve: TxtResolver = async () => [[expected]];
    const result = await lookupDomainToken(domain, expected, resolve);
    expect(result.verified).toBe(true);
    expect(result.found).toEqual([expected]);
  });

  it('queries the correct challenge record name', async () => {
    let queried = '';
    const resolve: TxtResolver = async (name) => { queried = name; return [[expected]]; };
    await lookupDomainToken(domain, expected, resolve);
    expect(queried).toBe(challengeRecordName(domain));
  });

  it('joins multi-chunk TXT records before matching', async () => {
    const resolve: TxtResolver = async () => [[VALUE_PREFIX, token]];
    const result = await lookupDomainToken(domain, expected, resolve);
    expect(result.verified).toBe(true);
  });

  it('finds the value among several unrelated TXT records', async () => {
    const resolve: TxtResolver = async () => [
      ['v=spf1 include:_spf.google.com ~all'],
      ['some-other=thing'],
      [expected],
    ];
    const result = await lookupDomainToken(domain, expected, resolve);
    expect(result.verified).toBe(true);
    expect(result.found).toHaveLength(3);
  });

  it('does not verify when the token does not match', async () => {
    const resolve: TxtResolver = async () => [[challengeRecordValue('wrong-token')]];
    const result = await lookupDomainToken(domain, expected, resolve);
    expect(result.verified).toBe(false);
    expect(result.found).toEqual([challengeRecordValue('wrong-token')]);
  });

  it('treats a DNS resolution error (ENOTFOUND) as not verified, not a throw', async () => {
    const resolve: TxtResolver = async () => { throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' }); };
    const result = await lookupDomainToken(domain, expected, resolve);
    expect(result.verified).toBe(false);
    expect(result.found).toEqual([]);
  });

  it('treats an empty record set as not verified', async () => {
    const resolve: TxtResolver = async () => [];
    const result = await lookupDomainToken(domain, expected, resolve);
    expect(result.verified).toBe(false);
  });
});
