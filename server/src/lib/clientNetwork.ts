import { isIPv4, isIPv6 } from 'node:net';

/** 16-bit groups in an IPv6 address, and in its /64 network prefix. */
const IPV6_GROUPS = 8;
const PREFIX_GROUPS = 4;

/**
 * The key that per-client limits (rate limits, login lockouts) count against.
 *
 * An IPv4 address is one client. One IPv6 host, though, usually gets a whole
 * /64 (2^64 addresses), so keying on the full address would let it rotate to
 * a fresh address for every request. IPv6 clients are therefore keyed by
 * their /64, and an IPv4-mapped IPv6 address (::ffff:a.b.c.d) by its IPv4
 * address. Anything that is not an IP address is returned unchanged.
 */
export function clientNetworkKey(ip: string): string {
  if (isIPv4(ip)) return ip;
  const groups = ipv6Groups(ip);
  if (!groups) return ip;
  if (isIPv4Mapped(groups)) return ipv4FromGroups(groups[6]!, groups[7]!);
  const prefix = groups.slice(0, PREFIX_GROUPS).map((group) => group.toString(16));
  return `${prefix.join(':')}::/64`;
}

/** Expands an IPv6 address (with `::`, a zone or an IPv4 tail) to 8 numbers. */
function ipv6Groups(ip: string): number[] | null {
  const address = ip.split('%')[0]!;
  if (!isIPv6(address)) return null;
  const [head = '', tail] = address.split('::');
  const parse = (part: string) => (part === '' ? [] : part.split(':').flatMap(parseGroup));
  const left = parse(head);
  const right = tail === undefined ? [] : parse(tail);
  const zeros = new Array<number>(IPV6_GROUPS - left.length - right.length).fill(0);
  return [...left, ...zeros, ...right];
}

/** One `:`-separated part: a hex group, or a dotted IPv4 tail (two groups). */
function parseGroup(part: string): number[] {
  if (!part.includes('.')) return [parseInt(part, 16)];
  const [a, b, c, d] = part.split('.').map(Number) as [number, number, number, number];
  return [(a << 8) | b, (c << 8) | d];
}

function isIPv4Mapped(groups: number[]): boolean {
  return groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
}

function ipv4FromGroups(high: number, low: number): string {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}
