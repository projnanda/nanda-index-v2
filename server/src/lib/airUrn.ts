/**
 * ARD domain-anchored resource identifiers (AIR URNs):
 *
 *   urn:air:<publisher-FQDN>:<namespace...>:<short-name>
 *
 * e.g. urn:air:skyblue.com:agent:refunds, urn:air:example.com:catalog:root.
 * Every NANDA Index entry is keyed on one of these — the publisher FQDN is the
 * ownership anchor (proven via DNS TXT challenge), so it must be a real FQDN.
 * Individuals without a domain are anchored to their card host instead
 * (urn:air:host39.org:personal:<email>), with the email carried as the
 * entry's `subjectAccount` extension. The email is used verbatim (lowercased,
 * percent-encoding only what a URN segment can't hold), so the mapping is
 * reversible and two different emails can never share an identifier.
 */

export interface ParsedAirUrn {
  /** Normalised identifier: lowercase scheme/NID/FQDN, path segments verbatim. */
  readonly urn: string;
  readonly publisherDomain: string;
  readonly namespace: readonly string[];
  readonly shortName: string;
}

/** The third-party card host that anchors identifiers for domain-less individuals. */
export const PERSONAL_CARD_HOST = {
  domain: 'host39.org',
  displayName: 'Host39',
} as const;

export const PERSONAL_NAMESPACE = 'personal';

const AIR_PREFIX = 'urn:air:';
const FQDN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** RFC 8141 NSS characters, minus ':' (our segment separator): unreserved,
 *  sub-delims, '@', and percent-encoded octets. */
const SEGMENT_RE = /^(?:[A-Za-z0-9._~!$&'()*+,;=@-]|%[0-9A-Fa-f]{2})+$/;
const SEGMENT_LITERAL_RE = /^[a-z0-9._~!$&'()*+,;=@-]$/;

export function isFqdn(value: string): boolean {
  return FQDN_RE.test(value.toLowerCase());
}

/** Parses and validates an AIR URN. Throws an Error describing the first problem found. */
export function parseAirUrn(raw: string): ParsedAirUrn {
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith(AIR_PREFIX)) {
    throw new Error(`invalid identifier "${trimmed}": must start with "${AIR_PREFIX}"`);
  }

  const [rawDomain = '', ...path] = trimmed.slice(AIR_PREFIX.length).split(':');
  const publisherDomain = rawDomain.toLowerCase();
  if (!isFqdn(publisherDomain)) {
    throw new Error(`invalid identifier "${trimmed}": publisher "${rawDomain}" is not a valid FQDN`);
  }
  if (path.length < 2) {
    throw new Error(`invalid identifier "${trimmed}": expected <publisher-FQDN>:<namespace...>:<short-name>`);
  }
  const badSegment = path.find((segment) => !SEGMENT_RE.test(segment));
  if (badSegment !== undefined) {
    throw new Error(`invalid identifier "${trimmed}": segment "${badSegment}" is empty or contains illegal characters`);
  }

  const namespace = path.slice(0, -1);
  const rawShortName = path[path.length - 1]!;
  const shortName = isPersonalNamespace(publisherDomain, namespace)
    ? normaliseEmailSegment(rawShortName)
    : rawShortName;

  return {
    urn: `${AIR_PREFIX}${publisherDomain}:${[...namespace, shortName].join(':')}`,
    publisherDomain,
    namespace,
    shortName,
  };
}

function isPersonalNamespace(publisherDomain: string, namespace: readonly string[]): boolean {
  return publisherDomain === PERSONAL_CARD_HOST.domain && namespace.length === 1 && namespace[0] === PERSONAL_NAMESPACE;
}

/** Personal short-names are emails, matched case-insensitively like emailSegment()
 *  stores them: lowercase text, upper-hex %-escapes ("A%2fB@X.com" → "a%2Fb@x.com"). */
function normaliseEmailSegment(segment: string): string {
  return segment.replace(/%[0-9A-Fa-f]{2}|[^%]+/g, (part) => (part.startsWith('%') ? part.toUpperCase() : part.toLowerCase()));
}

/** Builds a validated, normalised AIR URN from its parts. */
export function buildAirUrn(publisherDomain: string, namespace: readonly string[], shortName: string): string {
  return parseAirUrn(`${AIR_PREFIX}${publisherDomain}:${[...namespace, shortName].join(':')}`).urn;
}

/**
 * An email as a personal short-name: trimmed and lowercased, kept verbatim
 * where URN-safe ("john@hotmail.com"), with every other character
 * percent-encoded as UTF-8 ("a#b@x.com" → "a%23b@x.com"). Reversible, so it
 * is collision-free — unlike a slug, which maps many emails to one name.
 */
export function emailSegment(email: string): string {
  return [...email.trim().toLowerCase()]
    .map((ch) => SEGMENT_LITERAL_RE.test(ch)
      ? ch
      : [...Buffer.from(ch, 'utf8')].map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`).join(''))
    .join('');
}

/** Card-host-anchored identifier for a domain-less individual. */
export function personalAirUrn(email: string): string {
  return buildAirUrn(PERSONAL_CARD_HOST.domain, [PERSONAL_NAMESPACE], emailSegment(email));
}

/** Re-anchors an identifier to a new publisher domain, keeping its namespace path. */
export function reanchorAirUrn(identifier: string, newDomain: string): string {
  const parsed = parseAirUrn(identifier);
  return buildAirUrn(newDomain, parsed.namespace, parsed.shortName);
}
