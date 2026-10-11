import { BlockList, isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

/**
 * SSRF guard for server-side fetches of registrant-controlled URLs (e.g. a
 * registry_url fanned out to during agentic search). A URL is allowed only if
 * it is http(s) and its host — an IP literal, or every address the hostname
 * resolves to — is publicly routable. Callers must also refuse redirects, or
 * a public host could bounce the request to an internal one.
 *
 * Residual risk: DNS can change between this check and the connection
 * (rebinding). Closing that fully needs connect-time address pinning.
 */

export class OutboundUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboundUrlError';
  }
}

/** Resolves a hostname to all of its IP addresses. Injectable for tests. */
export type HostLookup = (hostname: string) => Promise<string[]>;

export type UrlGuard = (url: string) => Promise<void>;

const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],        // "this" network / unspecified
  ['10.0.0.0', 8],       // RFC 1918
  ['100.64.0.0', 10],    // carrier-grade NAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12],    // RFC 1918
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.168.0.0', 16],   // RFC 1918
  ['198.18.0.0', 15],    // benchmarking
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reserved, incl. broadcast
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],           // unspecified
  ['::1', 128],          // loopback
  ['fc00::', 7],         // unique-local
  ['fe80::', 10],        // link-local
  ['ff00::', 8],         // multicast
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv6');
}

// IPv4-mapped IPv6 (::ffff:a.b.c.d) is never a legitimate public target here.
// Kept in its own list: BlockList also matches plain IPv4 addresses against
// this range, which would block every IPv4 address if it lived in BLOCKED.
const IPV4_MAPPED = new BlockList();
IPV4_MAPPED.addSubnet('::ffff:0:0', 96, 'ipv6');

function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 4) return BLOCKED.check(address, 'ipv4');
  return BLOCKED.check(address, 'ipv6') || IPV4_MAPPED.check(address, 'ipv6');
}

const defaultLookup: HostLookup = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

export async function assertPublicHttpUrl(rawUrl: string, lookup: HostLookup = defaultLookup): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new OutboundUrlError(`refusing to fetch "${rawUrl}": not a valid URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new OutboundUrlError(`refusing to fetch "${rawUrl}": protocol ${url.protocol} is not allowed`);
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(host) !== 0) {
    addresses = [host];
  } else {
    try {
      addresses = await lookup(host);
    } catch {
      throw new OutboundUrlError(`refusing to fetch "${rawUrl}": host ${host} does not resolve`);
    }
  }

  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new OutboundUrlError(`refusing to fetch "${rawUrl}": host ${host} resolves to a non-public address`);
  }
}

/** Guard used when OUTBOUND_ALLOW_PRIVATE_HOSTS is set (local development only). */
export const allowAnyUrl: UrlGuard = async () => {};

export const publicUrlGuard: UrlGuard = (url) => assertPublicHttpUrl(url);
