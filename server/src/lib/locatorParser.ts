import type { ParsedLocator } from '../types/api/resolve.js';

/**
 * NID validation: 1–31 chars, letters/digits/hyphens, not starting with hyphen.
 * The reserved value "urn" itself is disallowed as an NID.
 */
const NID_RE = /^[a-z0-9][a-z0-9-]{0,30}$/i;

/**
 * URN agent locator into its components.
 *
 * Format: urn:<nid>:<domain>:<identifier>
 * Example: urn:ai:nasiko.com:ankit
 *
 * The NID (e.g. "ai") is schema-agnostic — the caller selects the NID when
 * registering agents; this parser accepts any RFC 8141-valid NID so the URN
 * schema can evolve without a parser change.
 *
 * @param raw - the raw URN string
 * @returns ParsedLocator with urn, nid, domain, and identifier
 * @throws Error with a descriptive message on any malformed input
 */
export function parseLocator(raw: string): ParsedLocator {
  const trimmed = raw.trim();

  if (!trimmed.toLowerCase().startsWith('urn:')) {
    throw new Error(
      `invalid locator "${trimmed}": must start with "urn:" (RFC 8141)`,
    );
  }

  // After "urn:", split into NID and NSS on the first colon
  const rest = trimmed.slice(4); // drop "urn:"
  const nidEnd = rest.indexOf(':');
  if (nidEnd === -1) {
    throw new Error(
      `invalid locator "${trimmed}": missing NID — expected urn:<nid>:<domain>:<identifier>`,
    );
  }

  const nid = rest.slice(0, nidEnd);
  const nss = rest.slice(nidEnd + 1); // Namespace Specific String

  if (!NID_RE.test(nid)) {
    throw new Error(
      `invalid locator "${trimmed}": NID "${nid}" is not a valid namespace identifier`,
    );
  }

  if (nid.toLowerCase() === 'urn') {
    throw new Error(
      `invalid locator "${trimmed}": "urn" is a reserved NID and cannot be used (§2)`,
    );
  }

  // Extended host39 grammar: urn:<nid>:(domain|email):<authority>:agent:<slug>
  // host39 publishes agent cards with this longer form, e.g.
  //   urn:ai:domain:moonbakery.com:agent:orders   (business)
  //   urn:ai:email:john@acme.com:agent:assistant  (personal)
  // Map the authority segment to `domain` and the trailing slug to `identifier`
  // so business agents resolve through the same domain lookup as the canonical
  // four-segment form. (Personal/email authorities currently have no index
  // lookup and will simply resolve to not_found; see resolveAgent.)
  const nssParts = nss.split(':');
  if (
    nssParts.length === 4 &&
    (nssParts[0] === 'domain' || nssParts[0] === 'email') &&
    nssParts[2] === 'agent'
  ) {
    const authority = nssParts[1];
    const slug = nssParts[3];
    if (!authority) {
      throw new Error(`invalid locator "${trimmed}": ${nssParts[0]} authority is empty`);
    }
    if (!slug) {
      throw new Error(`invalid locator "${trimmed}": agent slug is empty`);
    }
    return {
      urn: trimmed,
      nid: nid.toLowerCase(),
      domain: authority,
      identifier: slug,
    };
  }

  // NSS must have at least one colon separating domain from identifier
  const domainEnd = nss.indexOf(':');
  if (domainEnd === -1) {
    throw new Error(
      `invalid locator "${trimmed}": NSS "${nss}" must be <domain>:<identifier>`,
    );
  }

  const domain = nss.slice(0, domainEnd);
  const identifier = nss.slice(domainEnd + 1);

  if (!domain) {
    throw new Error(`invalid locator "${trimmed}": domain component is empty`);
  }
  if (!identifier) {
    throw new Error(`invalid locator "${trimmed}": identifier component is empty`);
  }
  if (identifier.includes(':')) {
    throw new Error(
      `invalid locator "${trimmed}": identifier "${identifier}" must not contain colons`,
    );
  }

  return {
    urn: trimmed,
    nid: nid.toLowerCase(),
    domain,
    identifier,
  };
}
