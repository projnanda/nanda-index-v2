import type { PublisherBlock } from '../types/api/index-record.js';
import { NANDA_MEDIA_TYPE, NANDA_MEDIA_TYPES } from './mediaTypes.js';
import {
  PERSONAL_CARD_HOST,
  buildAirUrn,
  parseAirUrn,
  personalAirUrn,
  reanchorAirUrn,
} from './airUrn.js';

/**
 * Derives the AI Catalog-facing parts of an index entry — identifier, type,
 * publisher and the `org.projectnanda` extension — from how the registrant
 * hosts their agent (paper §6). The server owns these fields: an identifier
 * must be anchored to the domain the registrant proves control of, and the
 * resolution-role keys describe how NANDA routes the entry, so clients may
 * not override either.
 */

export type HostingPath = 'registry' | 'dns-svcb' | 'smb' | 'personal';
export const HOSTING_PATHS: readonly HostingPath[] = ['registry', 'dns-svcb', 'smb', 'personal'];

export const NANDA_EXTENSION = 'org.projectnanda';

/** Every registrable media type (see mediaTypes.ts, the single source). */
export const ALLOWED_MEDIA_TYPES: readonly string[] = NANDA_MEDIA_TYPES;

/** AI Catalog `extensions`: reverse-DNS namespace → that namespace's fields. */
export type CatalogExtensions = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export interface EntryProfile {
  readonly identifier: string;
  readonly mediaType: string;
  readonly publisher: PublisherBlock;
  readonly extensions: CatalogExtensions;
}

export interface EntryProfileInput {
  readonly path: HostingPath;
  readonly orgId: string;
  readonly domain: string | null;
  readonly contactEmail: string;
  readonly displayName: string;
  readonly identifier?: string;
  readonly mediaType?: string;
  readonly publisherDisplayName?: string;
  readonly extensions?: CatalogExtensions;
}

export interface EntryProfileUpdate {
  readonly domain?: string;
  readonly publisherDisplayName?: string;
  readonly extensions?: CatalogExtensions;
}

export class EntryProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntryProfileError';
  }
}

/** Keys in the NANDA extension that only the server may set. */
const SERVER_OWNED_KEYS: readonly string[] = ['resolutionRole', 'preferredDiscovery', 'authoritativeSystem', 'subjectAccount'];

/** Operational fields the server adds to the NANDA extension on read
 *  (GET /api/v1/index). Never stored — dropped if a client sends them back. */
export const NANDA_OUTPUT_KEYS: readonly string[] = [
  'orgId', 'status', 'ttlSeconds', 'emailVerified', 'domainVerified',
  'createdAt', 'domain', 'representativeQueries',
];

interface PathRules {
  readonly mediaType: string;
  /** Server-owned NANDA extension fields. */
  readonly owned: (domain: string | null, email: string) => Record<string, unknown>;
  /** NANDA extension fields a client may override. */
  readonly defaults: Record<string, unknown>;
}

const PATH_RULES: Readonly<Record<HostingPath, PathRules>> = {
  registry: {
    mediaType: NANDA_MEDIA_TYPE.AI_CATALOG,
    owned: () => ({ resolutionRole: 'nested-ai-catalog', preferredDiscovery: 'ai-catalog' }),
    defaults: { nandaIndexRole: 'optional-fallback-entry' },
  },
  'dns-svcb': {
    mediaType: NANDA_MEDIA_TYPE.A2A_CARD,
    owned: (domain) => ({
      resolutionRole: 'dns-svcb-pointer',
      preferredDiscovery: 'dns-svcb',
      authoritativeSystem: `${domain} DNS`,
    }),
    defaults: { nandaIndexRole: 'federated-pointer' },
  },
  smb: {
    mediaType: NANDA_MEDIA_TYPE.A2A_CARD,
    owned: () => ({ resolutionRole: 'smb-agent-card', preferredDiscovery: 'nandaindex' }),
    defaults: {},
  },
  personal: {
    mediaType: NANDA_MEDIA_TYPE.A2A_CARD,
    owned: (_domain, email) => ({
      resolutionRole: 'personal-agent-card',
      preferredDiscovery: 'nandaindex',
      subjectAccount: email,
    }),
    defaults: { agentCardHost: PERSONAL_CARD_HOST.domain },
  },
};

function pickNanda(extensions: CatalogExtensions | undefined, owned: boolean): Record<string, unknown> {
  const nanda = extensions?.[NANDA_EXTENSION] ?? {};
  return Object.fromEntries(
    Object.entries(nanda)
      .filter(([key]) => !NANDA_OUTPUT_KEYS.includes(key))
      .filter(([key]) => SERVER_OWNED_KEYS.includes(key) === owned),
  );
}

function mergeNandaExtension(
  client: CatalogExtensions | undefined,
  defaults: Record<string, unknown>,
  owned: Record<string, unknown>,
): CatalogExtensions {
  return { ...client, [NANDA_EXTENSION]: { ...owned, ...defaults, ...pickNanda(client, false) } };
}

function parseIdentifier(identifier: string): ReturnType<typeof parseAirUrn> {
  try {
    return parseAirUrn(identifier);
  } catch (err) {
    throw new EntryProfileError((err as Error).message);
  }
}

function resolveIdentifier(input: EntryProfileInput, domain: string | null, email: string): string {
  if (input.path === 'personal') {
    const expected = personalAirUrn(email);
    if (input.identifier !== undefined && parseIdentifier(input.identifier).urn !== expected) {
      throw new EntryProfileError(`personal identifiers are derived from the contact email; expected "${expected}"`);
    }
    return expected;
  }

  if (input.identifier === undefined) {
    return input.path === 'registry'
      ? buildAirUrn(domain!, ['catalog'], 'root')
      : buildAirUrn(domain!, ['agent'], input.orgId);
  }

  const parsed = parseIdentifier(input.identifier);
  if (parsed.publisherDomain !== domain) {
    throw new EntryProfileError(`identifier "${parsed.urn}" must be anchored to the registering domain "${domain}"`);
  }
  return parsed.urn;
}

export function buildEntryProfile(input: EntryProfileInput): EntryProfile {
  const rules = PATH_RULES[input.path];
  const isPersonal = input.path === 'personal';
  if (!isPersonal && !input.domain) {
    throw new EntryProfileError(`domain is required for the ${input.path} hosting path`);
  }

  const email = input.contactEmail.trim().toLowerCase();
  const domain = isPersonal ? null : input.domain!.toLowerCase();
  const publisher: PublisherBlock = isPersonal
    ? { identifier: PERSONAL_CARD_HOST.domain, displayName: PERSONAL_CARD_HOST.displayName, identityType: 'dns' }
    : { identifier: domain!, displayName: input.publisherDisplayName ?? input.displayName, identityType: 'dns' };

  return {
    identifier: resolveIdentifier(input, domain, email),
    mediaType: input.mediaType ?? rules.mediaType,
    publisher,
    extensions: mergeNandaExtension(input.extensions, rules.defaults, rules.owned(domain, email)),
  };
}

/**
 * Applies an update to an existing entry. A domain change re-anchors the
 * identifier and publisher (the caller resets domain verification); client
 * extensions replace the stored ones, minus the server-owned keys.
 */
export function updateEntryProfile(current: EntryProfile, patch: EntryProfileUpdate): EntryProfile {
  const newDomain = patch.domain?.toLowerCase();
  const domainChanged = newDomain !== undefined && newDomain !== current.publisher.identifier;

  const storedOwned = pickNanda(current.extensions, true);
  const owned = domainChanged && 'authoritativeSystem' in storedOwned
    ? { ...storedOwned, authoritativeSystem: `${newDomain} DNS` }
    : storedOwned;

  return {
    identifier: domainChanged ? reanchorAirUrn(current.identifier, newDomain) : current.identifier,
    mediaType: current.mediaType,
    publisher: {
      ...current.publisher,
      ...(domainChanged ? { identifier: newDomain } : {}),
      ...(patch.publisherDisplayName !== undefined ? { displayName: patch.publisherDisplayName } : {}),
    },
    extensions: mergeNandaExtension(patch.extensions ?? current.extensions, {}, owned),
  };
}
