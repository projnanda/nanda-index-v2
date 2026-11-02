import { describe, it, expect } from 'vitest';
import { clientNetworkKey } from '../../src/lib/clientNetwork.js';

describe('clientNetworkKey', () => {
  it('keeps an IPv4 address as is', () => {
    expect(clientNetworkKey('203.0.113.66')).toBe('203.0.113.66');
  });

  it('treats an IPv4-mapped IPv6 address as the IPv4 address', () => {
    expect(clientNetworkKey('::ffff:203.0.113.66')).toBe('203.0.113.66');
    expect(clientNetworkKey('::FFFF:cb00:7142')).toBe('203.0.113.66');
  });

  it('groups every IPv6 address in one /64', () => {
    const key = clientNetworkKey('2001:db8:1:2::1');
    expect(key).toBe('2001:db8:1:2::/64');
    expect(clientNetworkKey('2001:0db8:0001:0002:ffff:ffff:ffff:fffe')).toBe(key);
    expect(clientNetworkKey('2001:DB8:1:2:a:b:c:d')).toBe(key);
  });

  it('keeps different /64s apart', () => {
    expect(clientNetworkKey('2001:db8:1:3::1')).not.toBe(clientNetworkKey('2001:db8:1:2::1'));
  });

  it('expands :: anywhere in the address', () => {
    expect(clientNetworkKey('::1')).toBe('0:0:0:0::/64');
    expect(clientNetworkKey('2001:db8::')).toBe('2001:db8:0:0::/64');
    expect(clientNetworkKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('handles an embedded IPv4 tail on a non-mapped address', () => {
    expect(clientNetworkKey('64:ff9b::192.0.2.33')).toBe('64:ff9b:0:0::/64');
  });

  it('returns anything that is not an IP address unchanged', () => {
    expect(clientNetworkKey('unknown')).toBe('unknown');
    expect(clientNetworkKey('')).toBe('');
  });
});
