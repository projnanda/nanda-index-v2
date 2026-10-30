import { BlockList, isIP, type LookupFunction } from 'node:net';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import { Agent, fetch as undiciFetch } from 'undici';

/**
 * SSRF guard for server-side fetches of registrant-controlled URLs (e.g. a
 * registry_url fanned out to during agentic search). A URL is allowed only if
 * it is http(s) and its host — an IP literal, or every address the hostname
 * resolves to — is publicly routable. Callers must also refuse redirects, or
 * a public host could bounce the request to an internal one.
 *
 * DNS rebinding: checking the name and then letting fetch resolve it again
 * leaves a window where a hostile DNS server answers public for the check and
 * private for the connection. So a guard does not just approve a URL — it
 * hands back a fetch whose connections are pinned to the addresses it checked
 * (see pinnedFetch); the hostname is never resolved a second time.
 */

export class OutboundUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboundUrlError';
  }
}

/** Resolves a hostname to all of its IP addresses. Injectable for tests. */
export type HostLookup = (hostname: string) => Promise<string[]>;

/** The slice of a fetch Response that outbound callers use. */
export interface OutboundResponse {
  ok: boolean;
  status: number;
  /** Used to refuse an oversized body before reading it (remoteEntry.readCappedJson). */
  headers: { get(name: string): string | null };
  /** Read incrementally so a remote registry cannot make us buffer an unbounded body. */
  body: AsyncIterable<Uint8Array> | null;
  json(): Promise<unknown>;
}

export interface OutboundInit {
  signal?: AbortSignal;
  redirect?: 'error' | 'manual' | 'follow';
}

export type OutboundFetch = (url: string, init?: OutboundInit) => Promise<OutboundResponse>;

/**
 * Checks a URL and returns the fetch to use for it. Throws OutboundUrlError
 * when the URL must not be fetched. The returned fetch is only valid for the
 * URL that was checked.
 */
export type UrlGuard = (url: string) => Promise<OutboundFetch>;

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
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['2002::', 16],
  ['2001::', 32],
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

/**
 * Validates `rawUrl` as above and returns the public addresses its host
 * resolved to — the only addresses a connection to it may then use.
 */
export async function resolvePublicHttpUrl(rawUrl: string, lookup: HostLookup = defaultLookup): Promise<string[]> {
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
  return addresses;
}

export async function assertPublicHttpUrl(rawUrl: string, lookup: HostLookup = defaultLookup): Promise<void> {
  await resolvePublicHttpUrl(rawUrl, lookup);
}

/**
 * A connect-time lookup (net.connect's `lookup` option) that answers every
 * hostname with the given, already-validated addresses and never consults
 * DNS. If none match a requested family it fails instead of falling back.
 */
export function pinnedLookup(addresses: readonly string[]): LookupFunction {
  const entries = addresses.map((address) => ({ address, family: isIP(address) }));
  return ((hostname: string, options: LookupOptions, callback: PinnedLookupCallback) => {
    const family = options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : options.family;
    const usable = family === 4 || family === 6 ? entries.filter((e) => e.family === family) : entries;
    if (usable.length === 0) {
      const err: NodeJS.ErrnoException = new Error(`no pinned IPv${family} address for ${hostname}`);
      err.code = 'ENOTFOUND';
      callback(err, '', 0);
      return;
    }
    if (options.all) callback(null, usable);
    else callback(null, usable[0]!.address, usable[0]!.family);
  }) as LookupFunction;
}

type PinnedLookupCallback = (
  err: NodeJS.ErrnoException | null,
  addressOrAll: string | LookupAddress[],
  family?: number,
) => void;

/**
 * A fetch whose connections go only to `addresses`. Each call gets its own
 * short-lived undici Agent so the pin can't leak into other requests; the
 * agent is closed once the response is in (close lets the body finish).
 */
export function pinnedFetch(addresses: readonly string[]): OutboundFetch {
  return async (url, init) => {
    const dispatcher = new Agent({ connect: { lookup: pinnedLookup(addresses) } });
    try {
      const res = await undiciFetch(url, { ...init, dispatcher });
      void dispatcher.close().catch(() => {});
      return res;
    } catch (err) {
      void dispatcher.destroy().catch(() => {});
      throw err;
    }
  };
}

/** Builds the public-only guard around a given resolver (injectable for tests). */
export function publicUrlGuardWith(lookup: HostLookup): UrlGuard {
  return async (url) => pinnedFetch(await resolvePublicHttpUrl(url, lookup));
}

/** Guard used when OUTBOUND_ALLOW_PRIVATE_HOSTS is set (local development only).
 *  Uses the global fetch, read at call time, so tests can stub it. */
export const allowAnyUrl: UrlGuard = async () => (url, init) => globalThis.fetch(url, init);

export const publicUrlGuard: UrlGuard = publicUrlGuardWith(defaultLookup);
