import { describe, it, expect } from 'vitest';
import {
  parseAirUrn,
  buildAirUrn,
  personalAirUrn,
  emailToSlug,
  reanchorAirUrn,
} from '../../src/lib/airUrn.js';

describe('parseAirUrn — urn:air:<publisher-FQDN>:<namespace...>:<short-name>', () => {
  it('parses an agent identifier', () => {
    expect(parseAirUrn('urn:air:skyblue.com:agent:refunds')).toEqual({
      urn: 'urn:air:skyblue.com:agent:refunds',
      publisherDomain: 'skyblue.com',
      namespace: ['agent'],
      shortName: 'refunds',
    });
  });

  it('parses a catalog root identifier', () => {
    const parsed = parseAirUrn('urn:air:example.com:catalog:root');
    expect(parsed.publisherDomain).toBe('example.com');
    expect(parsed.namespace).toEqual(['catalog']);
    expect(parsed.shortName).toBe('root');
  });

  it('supports multi-segment namespaces', () => {
    const parsed = parseAirUrn('urn:air:acme.com:agents:billing:refunds');
    expect(parsed.namespace).toEqual(['agents', 'billing']);
    expect(parsed.shortName).toBe('refunds');
  });

  it('parses a host-anchored personal identifier', () => {
    const parsed = parseAirUrn('urn:air:host39.org:personal:john-hotmail-com');
    expect(parsed.publisherDomain).toBe('host39.org');
    expect(parsed.namespace).toEqual(['personal']);
    expect(parsed.shortName).toBe('john-hotmail-com');
  });

  it('normalises the scheme, NID and publisher FQDN to lowercase and trims', () => {
    const parsed = parseAirUrn('  URN:AIR:SkyBlue.COM:agent:Refunds  ');
    expect(parsed.urn).toBe('urn:air:skyblue.com:agent:Refunds');
    expect(parsed.publisherDomain).toBe('skyblue.com');
    expect(parsed.shortName).toBe('Refunds');
  });

  it('rejects the retired urn:ai: scheme', () => {
    expect(() => parseAirUrn('urn:ai:domain:example.com')).toThrow('urn:air:');
  });

  it('rejects input that is not a URN', () => {
    expect(() => parseAirUrn('john@hotmail.com')).toThrow('urn:air:');
  });

  it('rejects a publisher that is not a fully qualified domain name', () => {
    expect(() => parseAirUrn('urn:air:localhost:agent:x')).toThrow('FQDN');
    expect(() => parseAirUrn('urn:air:-bad.com:agent:x')).toThrow('FQDN');
  });

  it('requires at least a namespace and a short-name', () => {
    expect(() => parseAirUrn('urn:air:example.com')).toThrow('namespace');
    expect(() => parseAirUrn('urn:air:example.com:root')).toThrow('namespace');
  });

  it('rejects empty or illegal segments', () => {
    expect(() => parseAirUrn('urn:air:example.com::root')).toThrow('segment');
    expect(() => parseAirUrn('urn:air:example.com:agent:has space')).toThrow('segment');
    expect(() => parseAirUrn('urn:air:example.com:agent:a@b')).toThrow('segment');
  });
});

describe('buildAirUrn', () => {
  it('builds a normalised identifier from parts', () => {
    expect(buildAirUrn('MoonBakery.com', ['agent'], 'orders')).toBe('urn:air:moonbakery.com:agent:orders');
  });

  it('rejects parts that would produce an invalid identifier', () => {
    expect(() => buildAirUrn('moonbakery.com', [], 'orders')).toThrow();
    expect(() => buildAirUrn('not a domain', ['agent'], 'orders')).toThrow();
  });
});

describe('emailToSlug / personalAirUrn', () => {
  it('slugifies an email the way the paper does', () => {
    expect(emailToSlug('john@hotmail.com')).toBe('john-hotmail-com');
    expect(emailToSlug('  Jane.Doe+agents@Example.co.uk ')).toBe('jane-doe-agents-example-co-uk');
  });

  it('anchors personal identifiers to the card host', () => {
    expect(personalAirUrn('john@hotmail.com')).toBe('urn:air:host39.org:personal:john-hotmail-com');
  });
});

describe('reanchorAirUrn', () => {
  it('moves an identifier to a new publisher domain, keeping the path', () => {
    expect(reanchorAirUrn('urn:air:old.com:agent:orders', 'new.com')).toBe('urn:air:new.com:agent:orders');
  });
});
