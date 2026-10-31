import type { PublisherBlock } from '../types/api/index-record.js';
import { buildConfig } from '../config/index.js';
import { NANDA_MEDIA_TYPE, NANDA_MEDIA_TYPES, SINGLE_RESOURCE_MEDIA_TYPES } from './mediaTypes.js';
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
  'createdAt', 'domain', 'representativeQueries', 'emailVerifiedAt', 'domainVerifiedAt', 'cardValidation',
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

/**
 * Rejects an active-content URL anywhere in `extensions`, at any depth.
 *
 * The index is a directory that other people's software reads, and
 * `extensions` is published verbatim on every public read surface
 * (`/api/v1/index/:org_id`, `/api/v1/index`, `/api/v1/search`,
 * `/api/v1/resolve`, `/api/ard/agents`). A registrant could put
 * `javascript:...` in a URL-shaped field and have this index hand it to every
 * consumer that renders it as a link.
 *
 * This generalises the `runtime.url` check below, which guards the one key the
 * dashboard writes and leaves every other key — including a registrant's own
 * namespace — able to carry the same payload.
 *
 * Schemes only, not markup. `description` and `tags` have always been free
 * text, escaping is the consumer's job, and the index cannot know which fields
 * a consumer renders as HTML. A scheme that executes is different: there is no
 * reading of a directory entry in which one belongs.
 */
const SCRIPT_SCHEME = /^\s*(?:javascript|vbscript)\s*:/i;

/**
 * `data:` only where it declares markup. Deliberately narrow, because "data:"
 * is also ordinary English: `{"updated": "data: 2026-01-01"}` is metadata, not
 * an attack, and rejecting it would be a bug of its own. `data:image/png` is
 * harmless for the same reason. That reasoning rules out `file:`, `about:` and
 * `blob:` altogether — they collide with prose and are not injection vectors
 * in a JSON directory entry.
 */
const DATA_MARKUP_SCHEME =
  /^\s*data\s*:\s*(?:text\/html|image\/svg\+xml|application\/xhtml\+xml|text\/xml|application\/xml)/i;

/**
 * Control characters come out before the test because a browser strips them
 * too — `java<tab>script:alert(1)` navigates — so testing the raw string would
 * leave an evasion anyone could find in a minute.
 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

function isActiveContentUrl(value: string): boolean {
  const bare = value.replace(CONTROL_CHARS, '');
  return SCRIPT_SCHEME.test(bare) || DATA_MARKUP_SCHEME.test(bare);
}

function validateExtensionValues(extensions: CatalogExtensions | undefined): void {
  if (extensions === undefined) return;

  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      if (isActiveContentUrl(value)) {
        throw new EntryProfileError(
          `${path} must not be a javascript:, vbscript: or data:text/html URL`,
        );
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
    }
  };

  walk(extensions, 'extensions');
}

/**
 * Namespaces a registrant may publish under, when the anchored policy is on.
 *
 * The AI Catalog keys extensions by reverse-DNS namespace, and the index
 * already treats control of a domain as the thing that entitles you to speak
 * for it — that is what identifier anchoring means. The same rule applied to
 * extensions says: you may write under `org.projectnanda`, or under the
 * reverse-DNS form of the domain you proved.
 *
 * Off by default, because it is a policy change rather than a fix: of the 105
 * entries on the live index, one publishes under a namespace that is not its
 * own domain reversed, and turning this on would reject its next update. See
 * EXTENSION_NAMESPACE_POLICY in the README.
 */
function validateExtensionNamespaces(
  extensions: CatalogExtensions | undefined,
  domain: string | null,
): void {
  if (extensions === undefined) return;
  if (buildConfig().extensions.namespacePolicy !== 'anchored') return;

  const anchored = domain ? domain.split('.').reverse().join('.') : null;
  for (const namespace of Object.keys(extensions)) {
    if (namespace === NANDA_EXTENSION) continue;
    if (anchored !== null && namespace === anchored) continue;
    throw new EntryProfileError(
      anchored === null
        ? `extensions."${namespace}" is not allowed: an entry with no domain may only use "${NANDA_EXTENSION}"`
        : `extensions."${namespace}" is not allowed: use "${NANDA_EXTENSION}" or "${anchored}", the reverse-DNS form of the domain you proved`,
    );
  }
}

/**
 * The domain an existing entry proved, or null for a personal entry — whose
 * publisher is the shared card host, not a domain the registrant controls.
 */
function storedDomain(profile: EntryProfile): string | null {
  const role = profile.extensions[NANDA_EXTENSION]?.['resolutionRole'];
  return role === 'personal-agent-card' ? null : profile.publisher.identifier;
}

/** Validate the known URL hint without restricting other extension metadata. */
function validateRuntimeUrl(extensions: CatalogExtensions | undefined): void {
  const url = extensions?.[NANDA_EXTENSION]?.['runtime.url'];
  if (url === undefined) return;

  // URL parsing alone repairs missing authority slashes, backslashes and
  // control characters. Require an explicit HTTP(S) authority before parsing.
  if (typeof url === 'string' && /^https?:\/\/[^/\\\s]/i.test(url) && !/[\\\s\u0000-\u001f\u007f]/.test(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) return;
    } catch {
      // Report malformed URLs through the same validation error as bad types.
    }
  }
  throw new EntryProfileError('extensions.org.projectnanda.runtime.url must be an absolute HTTP(S) URL');
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
  validateRuntimeUrl(input.extensions);
  validateExtensionValues(input.extensions);
  const rules = PATH_RULES[input.path];
  const isPersonal = input.path === 'personal';
  if (!isPersonal && !input.domain) {
    throw new EntryProfileError(`domain is required for the ${input.path} hosting path`);
  }

  if (isPersonal && input.mediaType !== undefined
    && !(SINGLE_RESOURCE_MEDIA_TYPES as readonly string[]).includes(input.mediaType)) {
    throw new EntryProfileError(
      'personal registrations can publish an agent card, MCP server card or skill — catalogs and registries need a verified domain',
    );
  }

  const email = input.contactEmail.trim().toLowerCase();
  const domain = isPersonal ? null : input.domain!.toLowerCase();
  validateExtensionNamespaces(input.extensions, domain);
  // For personal entries, the publisher block identifies the URN naming
  // authority. It does not identify the card's author, owner, or hosting provider.
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
  // An unrelated edit must not revalidate legacy metadata that was not supplied.
  validateRuntimeUrl(patch.extensions);
  validateExtensionValues(patch.extensions);
  const newDomain = patch.domain?.toLowerCase();
  const domainChanged = newDomain !== undefined && newDomain !== current.publisher.identifier;
  validateExtensionNamespaces(patch.extensions, newDomain ?? storedDomain(current));

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
