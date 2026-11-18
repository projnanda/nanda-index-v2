import { BlockList, isIP } from 'node:net';

/**
 * Which X-Forwarded-For hops Fastify may trust (its `trustProxy` option).
 *
 * Fastify 5.12 ignores a bare hop count: counting hops alone cannot tell the
 * proxy from a client that reached the API directly and wrote the header
 * itself. So each trusted hop must also come from a private network. In
 * production that is Caddy on the compose network; the API publishes no port.
 */

const PRIVATE_NETWORKS = new BlockList();
for (const [network, prefix] of [
  ['10.0.0.0', 8],       // RFC 1918
  ['127.0.0.0', 8],      // loopback
  ['172.16.0.0', 12],    // RFC 1918, incl. Docker's default bridge networks
  ['192.168.0.0', 16],   // RFC 1918
] as const) {
  PRIVATE_NETWORKS.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::1', 128],          // loopback
  ['fc00::', 7],         // unique-local
] as const) {
  PRIVATE_NETWORKS.addSubnet(network, prefix, 'ipv6');
}

const IPV4_MAPPED_PREFIX = '::ffff:';

function isPrivateAddress(address: string): boolean {
  const unmapped = address.toLowerCase().startsWith(IPV4_MAPPED_PREFIX)
    ? address.slice(IPV4_MAPPED_PREFIX.length)
    : address;
  const family = isIP(unmapped);
  if (family === 4) return PRIVATE_NETWORKS.check(unmapped, 'ipv4');
  if (family === 6) return PRIVATE_NETWORKS.check(unmapped, 'ipv6');
  return false;
}

/** Trusts up to `hops` proxies, nearest first, each on a private network. */
export function trustPrivateProxyHops(hops: number): (address: string, hop: number) => boolean {
  return (address, hop) => hop < hops && isPrivateAddress(address);
}
