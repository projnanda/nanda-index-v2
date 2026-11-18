import { describe, it, expect } from 'vitest';
import { trustPrivateProxyHops } from '../../src/lib/trustProxy.js';

describe('trustPrivateProxyHops', () => {
  it('trusts a proxy on a private network within the hop count', () => {
    const trust = trustPrivateProxyHops(1);
    for (const address of ['172.18.0.2', '10.0.0.5', '192.168.1.1', '127.0.0.1', '::1', 'fd00::1', '::ffff:172.18.0.2']) {
      expect(trust(address, 0), address).toBe(true);
    }
  });

  it('does not trust hops beyond the configured count', () => {
    const trust = trustPrivateProxyHops(1);
    expect(trust('172.18.0.2', 1)).toBe(false);
    expect(trustPrivateProxyHops(2)('10.0.0.1', 1)).toBe(true);
  });

  // Fastify 5.12 dropped numeric (hop-count-only) trust because a client that
  // reaches the API directly could then pick its own address via X-Forwarded-For.
  it('never trusts a public peer, whatever the hop', () => {
    const trust = trustPrivateProxyHops(1);
    for (const address of ['198.51.100.7', '8.8.8.8', '2001:db8::1', '::ffff:8.8.8.8', 'not-an-ip']) {
      expect(trust(address, 0), address).toBe(false);
    }
  });
});
