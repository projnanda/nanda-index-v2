export type LocatorType = 'domain' | 'email';

export interface ParsedLocator {
  readonly urn: string;
  readonly nid: string;
  readonly type: LocatorType;
  /** The org domain — set for domain-type URNs, null for email-type. */
  readonly domain: string | null;
  /** The agent slug — set when the URN includes `:agent:<slug>`, null otherwise. */
  readonly agentSlug: string | null;
  /** The email address — set for email-type URNs, null for domain-type. */
  readonly email: string | null;
  /**
   * The identifier passed back in the resolution response.
   * For agent URNs this is the slug ("ankit").
   * For email URNs this is the full URN.
   */
  readonly identifier: string;
}

const NID_RE = /^[a-z0-9][a-z0-9-]{0,30}$/i;

/**
 * Parses a NANDA URN into its components.
 *
 * Supported formats:
 *   urn:ai:domain:<domain>               → org-level domain entry
 *   urn:ai:domain:<domain>:agent:<slug>  → specific agent under a domain
 *   urn:ai:email:<email>                 → email-identity (personal agent)
 *   urn:ai:<domain>:<slug>               → legacy format (backward compat)
 */
export function parseLocator(raw: string): ParsedLocator {
  const trimmed = raw.trim();

  if (!trimmed.toLowerCase().startsWith('urn:')) {
    throw new Error(`invalid locator "${trimmed}": must start with "urn:"`);
  }

  const rest = trimmed.slice(4); // drop "urn:"
  const nidEnd = rest.indexOf(':');
  if (nidEnd === -1) {
    throw new Error(`invalid locator "${trimmed}": missing NID`);
  }

  const nid = rest.slice(0, nidEnd).toLowerCase();
  const nss = rest.slice(nidEnd + 1);

  if (!NID_RE.test(nid)) {
    throw new Error(`invalid locator "${trimmed}": NID "${nid}" is not valid`);
  }

  const segments = nss.split(':');

  // ── Email-identity: urn:ai:email:<email> ──────────────────────────────────
  if (segments[0]?.toLowerCase() === 'email') {
    const email = segments.slice(1).join(':'); // re-join in case email had colons
    if (!email) {
      throw new Error(`invalid locator "${trimmed}": email component is empty`);
    }
    return {
      urn: trimmed,
      nid,
      type: 'email',
      domain: null,
      agentSlug: null,
      email,
      identifier: trimmed, // full URN used as identifier for email lookups
    };
  }

  // ── Spec domain format: urn:ai:domain:<domain>[:agent:<slug>] ─────────────
  if (segments[0]?.toLowerCase() === 'domain') {
    const domain = segments[1];
    if (!domain) {
      throw new Error(`invalid locator "${trimmed}": domain component is empty`);
    }

    // Optional :agent:<slug>
    let agentSlug: string | null = null;
    if (segments[2]?.toLowerCase() === 'agent') {
      agentSlug = segments[3] ?? null;
      if (!agentSlug) {
        throw new Error(`invalid locator "${trimmed}": agent slug is empty after ":agent:"`);
      }
    }

    return {
      urn: trimmed,
      nid,
      type: 'domain',
      domain,
      agentSlug,
      email: null,
      identifier: agentSlug ?? domain,
    };
  }

  // ── Legacy format: urn:ai:<domain>:<slug> ────────────────────────────────
  // First segment is the actual domain (contains a dot or is a known slug)
  const domain = segments[0]!;
  const agentSlug = segments[1] ?? null;

  if (!domain) {
    throw new Error(`invalid locator "${trimmed}": domain component is empty`);
  }

  return {
    urn: trimmed,
    nid,
    type: 'domain',
    domain,
    agentSlug,
    email: null,
    identifier: agentSlug ?? domain,
  };
}
