import { describe, it, expect } from 'vitest';
import { parseLocator } from '../../src/lib/locatorParser.js';

describe('parseLocator (URN format)', () => {

  // ── Happy paths ─────────────────────────────────────────────────────────────

  it('parses urn:ai:<domain>:<identifier>', () => {
    const result = parseLocator('urn:ai:nasiko.com:ankit');
    expect(result).toEqual({
      urn: 'urn:ai:nasiko.com:ankit',
      nid: 'ai',
      domain: 'nasiko.com',
      identifier: 'ankit',
    });
  });

  it('normalises NID to lowercase', () => {
    const result = parseLocator('urn:AI:nasiko.com:ankit');
    expect(result.nid).toBe('ai');
  });

  it('trims surrounding whitespace', () => {
    const result = parseLocator('  urn:ai:nasiko.com:ankit  ');
    expect(result.identifier).toBe('ankit');
    expect(result.domain).toBe('nasiko.com');
  });

  it('accepts any RFC 8141-valid NID — not locked to "ai"', () => {
    const result = parseLocator('urn:nanda:google.com:search');
    expect(result.nid).toBe('nanda');
    expect(result.domain).toBe('google.com');
    expect(result.identifier).toBe('search');
  });

  it('handles subdomains in domain component', () => {
    const result = parseLocator('urn:ai:agents.nasiko.com:refunds');
    expect(result.domain).toBe('agents.nasiko.com');
    expect(result.identifier).toBe('refunds');
  });

  it('preserves the full urn field verbatim (post-trim)', () => {
    const result = parseLocator('urn:ai:jetblue.com:scheduler');
    expect(result.urn).toBe('urn:ai:jetblue.com:scheduler');
  });

  // ── host39 extended grammar: urn:<nid>:(domain|email):<authority>:agent:<slug> ──

  it('parses the host39 business form (domain authority)', () => {
    const result = parseLocator('urn:ai:domain:moonbakery.com:agent:orders');
    expect(result).toEqual({
      urn: 'urn:ai:domain:moonbakery.com:agent:orders',
      nid: 'ai',
      domain: 'moonbakery.com',
      identifier: 'orders',
    });
  });

  it('parses the host39 personal form (email authority into domain field)', () => {
    const result = parseLocator('urn:ai:email:john@acme.com:agent:assistant');
    expect(result.domain).toBe('john@acme.com');
    expect(result.identifier).toBe('assistant');
  });

  it('throws on host39 form with empty authority', () => {
    expect(() => parseLocator('urn:ai:domain::agent:orders')).toThrow('authority is empty');
  });

  it('throws on host39 form with empty agent slug', () => {
    expect(() => parseLocator('urn:ai:domain:moonbakery.com:agent:')).toThrow('agent slug is empty');
  });

  // ── Error paths ─────────────────────────────────────────────────────────────

  it('throws on missing urn: prefix', () => {
    expect(() => parseLocator('ankit@nasiko.com:global')).toThrow('must start with "urn:"');
  });

  it('throws on missing NID (urn: only)', () => {
    expect(() => parseLocator('urn:')).toThrow('missing NID');
  });

  it('throws on invalid NID characters', () => {
    expect(() => parseLocator('urn:a_b:nasiko.com:ankit')).toThrow('not a valid namespace identifier');
  });

  it('throws on NID starting with hyphen', () => {
    expect(() => parseLocator('urn:-ai:nasiko.com:ankit')).toThrow('not a valid namespace identifier');
  });

  it('throws on reserved NID "urn"', () => {
    expect(() => parseLocator('urn:urn:nasiko.com:ankit')).toThrow('reserved NID');
  });

  it('throws on NSS missing domain:identifier separator', () => {
    expect(() => parseLocator('urn:ai:nasiko.com')).toThrow('must be <domain>:<identifier>');
  });

  it('throws on empty domain', () => {
    expect(() => parseLocator('urn:ai::ankit')).toThrow('domain component is empty');
  });

  it('throws on empty identifier', () => {
    expect(() => parseLocator('urn:ai:nasiko.com:')).toThrow('identifier component is empty');
  });

  it('throws on identifier with extra colons (ambiguous NSS)', () => {
    expect(() => parseLocator('urn:ai:nasiko.com:ankit:extra')).toThrow('must not contain colons');
  });

  it('throws on empty string', () => {
    expect(() => parseLocator('')).toThrow('must start with "urn:"');
  });

  it('throws on whitespace-only string', () => {
    expect(() => parseLocator('   ')).toThrow('must start with "urn:"');
  });
});
