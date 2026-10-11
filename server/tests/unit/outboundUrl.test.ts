import { describe, it, expect } from 'vitest';
import { assertPublicHttpUrl, OutboundUrlError, type HostLookup } from '../../src/lib/outboundUrl.js';

/** Resolves every hostname to the given addresses — no real DNS in tests. */
const resolvesTo = (...addresses: string[]): HostLookup => async () => addresses;

describe('assertPublicHttpUrl', () => {
  it('allows an http(s) URL whose host resolves only to public addresses', async () => {
    await expect(assertPublicHttpUrl('https://travel26.net/api/agents/search', resolvesTo('134.209.56.131'))).resolves.toBeUndefined();
    await expect(assertPublicHttpUrl('http://registry.example.org', resolvesTo('2606:4700::6810:84e5'))).resolves.toBeUndefined();
  });

  it.each([
    ['loopback', 'http://127.0.0.1:8080/x'],
    ['loopback, decimal form', 'http://2130706433/'],
    ['cloud metadata (link-local)', 'http://169.254.169.254/latest/meta-data/'],
    ['RFC1918 10/8', 'http://10.1.2.3/'],
    ['RFC1918 172.16/12', 'http://172.20.0.5/'],
    ['RFC1918 192.168/16', 'https://192.168.1.10/'],
    ['CGNAT 100.64/10', 'http://100.64.0.1/'],
    ['unspecified', 'http://0.0.0.0/'],
    ['IPv6 loopback', 'http://[::1]/'],
    ['IPv6 unique-local', 'http://[fd00::1]/'],
    ['IPv6 link-local', 'http://[fe80::1]/'],
    ['IPv4-mapped IPv6 loopback', 'http://[::ffff:127.0.0.1]/'],
  ])('refuses a literal %s address without any DNS lookup', async (_label, url) => {
    const lookup: HostLookup = async () => { throw new Error('lookup must not run for IP literals'); };
    await expect(assertPublicHttpUrl(url, lookup)).rejects.toBeInstanceOf(OutboundUrlError);
  });

  it('refuses a hostname that resolves to a private address (e.g. DNS pointing inside)', async () => {
    await expect(assertPublicHttpUrl('https://evil.example.com/agents', resolvesTo('10.0.0.7')))
      .rejects.toThrow(/non-public address/);
  });

  it('refuses when ANY resolved address is private, even if another is public', async () => {
    await expect(assertPublicHttpUrl('https://mixed.example.com', resolvesTo('93.184.216.34', '127.0.0.1')))
      .rejects.toBeInstanceOf(OutboundUrlError);
  });

  it('refuses localhost-style names and non-http protocols', async () => {
    await expect(assertPublicHttpUrl('http://localhost:3002', resolvesTo('127.0.0.1'))).rejects.toBeInstanceOf(OutboundUrlError);
    await expect(assertPublicHttpUrl('file:///etc/passwd', resolvesTo('93.184.216.34'))).rejects.toThrow(/protocol/);
    await expect(assertPublicHttpUrl('not a url', resolvesTo('93.184.216.34'))).rejects.toBeInstanceOf(OutboundUrlError);
  });

  it('refuses a hostname that does not resolve', async () => {
    const lookup: HostLookup = async () => { throw new Error('ENOTFOUND'); };
    await expect(assertPublicHttpUrl('https://nope.invalid', lookup)).rejects.toBeInstanceOf(OutboundUrlError);
  });
});
