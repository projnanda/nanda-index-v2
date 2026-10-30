import { describe, it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  assertPublicHttpUrl,
  OutboundUrlError,
  pinnedFetch,
  pinnedLookup,
  publicUrlGuardWith,
  resolvePublicHttpUrl,
  type HostLookup,
} from '../../src/lib/outboundUrl.js';

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

describe('pinned outbound fetch (DNS-rebinding defence)', () => {
  it('resolves the host once and pins the connection to the validated address — a rebound answer is never used', async () => {
    // First answer is public (passes the guard); a rebinding DNS server would
    // hand fetch's own resolution a private address the second time.
    const lookup = vi.fn<HostLookup>()
      .mockResolvedValueOnce(['93.184.216.34'])
      .mockResolvedValue(['127.0.0.1']);

    const addresses = await resolvePublicHttpUrl('https://rebind.example.com/agents', lookup);
    const connectLookup = pinnedLookup(addresses);
    const all = await new Promise<unknown>((resolve, reject) =>
      connectLookup('rebind.example.com', { all: true }, (err, result) => (err ? reject(err) : resolve(result))));
    const single = await new Promise<unknown>((resolve, reject) =>
      connectLookup('rebind.example.com', {}, (err, address) => (err ? reject(err) : resolve(address))));

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(all).toEqual([{ address: '93.184.216.34', family: 4 }]);
    expect(single).toBe('93.184.216.34');
  });

  it('honours a requested address family, failing rather than falling back to real DNS', async () => {
    const connectLookup = pinnedLookup(['93.184.216.34']);
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      connectLookup('v6only.example.com', { family: 6 }, (e) => resolve(e)));
    expect(err?.code).toBe('ENOTFOUND');
  });

  it('connects to the pinned address without resolving the hostname again', async () => {
    // The server listens on loopback; the hostname has no DNS at all, so the
    // request can only succeed if the connection uses the pinned address.
    const server = createServer((_req, res) => res.end('{"ok":true}'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const res = await pinnedFetch(['127.0.0.1'])(`http://no-dns.invalid:${port}/`, { redirect: 'error' });
      expect(res.ok).toBe(true);
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      server.close();
    }
  });

  it('publicUrlGuardWith refuses before any request when the host resolves privately', async () => {
    const guard = publicUrlGuardWith(resolvesTo('10.0.0.7'));
    await expect(guard('https://evil.example.com/agents')).rejects.toBeInstanceOf(OutboundUrlError);
  });

  it.each(['64:ff9b::127.0.0.1', '64:ff9b:1::a00:1', '2002:7f00:1::', '2001:0:4136:e378:8000:63bf:80ff:fffe'])(
    'rejects a redirect to %s before following it', async (address) => {
      const requests = vi.fn();
      const server = createServer((_request, response) => {
        requests();
        response.writeHead(302, { location: `http://[${address}]/internal` });
        response.end();
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      try {
        await expect(pinnedFetch(['127.0.0.1'])(`http://no-dns.invalid:${port}/`, { redirect: 'error' }))
          .rejects.toMatchObject({ cause: { message: 'unexpected redirect' } });
        expect(requests).toHaveBeenCalledOnce();
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    },
  );

  it('publicUrlGuardWith returns a fetch pinned to the addresses it validated, resolving only once', async () => {
    const lookup = vi.fn<HostLookup>().mockResolvedValue(['93.184.216.34']);
    const guarded = await publicUrlGuardWith(lookup)('https://ok.example.com/agents');
    expect(typeof guarded).toBe('function');
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
