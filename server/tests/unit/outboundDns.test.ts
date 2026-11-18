import { afterEach, describe, expect, it, vi } from 'vitest';

// The guard must not resolve with dns.lookup (getaddrinfo on libuv's small
// threadpool, which a registrant's slow DNS can exhaust for the whole process).
const { lookupMock, resolve4Mock, resolve6Mock, resolverOptions } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  resolve4Mock: vi.fn(),
  resolve6Mock: vi.fn(),
  resolverOptions: [] as unknown[],
}));
vi.mock('node:dns/promises', () => ({
  lookup: lookupMock,
  Resolver: class {
    constructor(options?: unknown) { resolverOptions.push(options); }
    resolve4(name: string) { return resolve4Mock(name); }
    resolve6(name: string) { return resolve6Mock(name); }
  },
}));

import { OutboundUrlError, publicUrlGuard, resolvePublicHttpUrl, resolverLookup } from '../../src/lib/outboundUrl.js';

const noData = () => Promise.reject(Object.assign(new Error('queryAaaa ENODATA'), { code: 'ENODATA' }));

afterEach(() => {
  vi.clearAllMocks();
  resolverOptions.length = 0;
});

describe('resolverLookup', () => {
  it('returns the A and AAAA answers together', async () => {
    const lookup = resolverLookup({
      resolve4: async () => ['93.184.216.34'],
      resolve6: async () => ['2606:2800:220:1::1'],
    });
    await expect(lookup('example.com')).resolves.toEqual(['93.184.216.34', '2606:2800:220:1::1']);
  });

  it('accepts a host with only one address family', async () => {
    const lookup = resolverLookup({ resolve4: async () => ['93.184.216.34'], resolve6: noData });
    await expect(lookup('v4only.example.com')).resolves.toEqual(['93.184.216.34']);
  });

  it('rejects when neither family resolves', async () => {
    const lookup = resolverLookup({ resolve4: noData, resolve6: noData });
    await expect(lookup('nope.invalid')).rejects.toThrow(/ENODATA/);
  });
});

describe('publicUrlGuard DNS', () => {
  it('resolves through a bounded c-ares Resolver, never dns.lookup', async () => {
    resolve4Mock.mockResolvedValue(['93.184.216.34']);
    resolve6Mock.mockImplementation(noData);

    await publicUrlGuard('https://registry.example.com/agents');

    expect(resolve4Mock).toHaveBeenCalledWith('registry.example.com');
    expect(lookupMock).not.toHaveBeenCalled();
    expect(resolverOptions).toContainEqual({ timeout: expect.any(Number), tries: expect.any(Number) });
  });

  it('still refuses a host whose answers include a private address', async () => {
    resolve4Mock.mockResolvedValue(['93.184.216.34', '10.0.0.5']);
    resolve6Mock.mockImplementation(noData);

    await expect(resolvePublicHttpUrl('https://mixed.example.com')).rejects.toBeInstanceOf(OutboundUrlError);
    expect(lookupMock).not.toHaveBeenCalled();
  });
});
