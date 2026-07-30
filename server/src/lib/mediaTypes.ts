/**
 * Single source of truth for the media-type vocabularies used across the Index.
 *
 * These literals were previously duplicated across the org create schema, the
 * fan-out service, the ARD mapping, the ARD registry document, and the org
 * insert default — so adding or renaming a type meant editing several files in
 * lockstep. Centralizing them keeps the vocabulary coherent and makes adding a
 * type a one-line change here.
 */

/** NANDA Index `media_type` vocabulary — the type an IndexRecord carries. */
export const NANDA_MEDIA_TYPE = {
  AI_CATALOG:  'application/ai-catalog+json',
  DNS_AID:     'application/vnd.dns-aid+json',
  A2A_CARD:    'application/a2a-agent-card+json',
  MCP_CARD:    'application/mcp-server-card+json',
  AGENT_SKILL: 'application/agentskill+zip',
} as const;

export type NandaMediaType = (typeof NANDA_MEDIA_TYPE)[keyof typeof NANDA_MEDIA_TYPE];

/** Every registrable NANDA media_type — backs the create-org schema enum. */
export const NANDA_MEDIA_TYPES: readonly NandaMediaType[] = Object.values(NANDA_MEDIA_TYPE);

/** The media_type an org insert defaults to when none is specified. */
export const DEFAULT_MEDIA_TYPE: NandaMediaType = NANDA_MEDIA_TYPE.AI_CATALOG;

/**
 * The enterprise catalog type: an org backed by a nanda-registry instance with
 * many agents underneath, fanned out to at query time — as opposed to the
 * single-agent card types, whose record already represents exactly one agent.
 */
export const ENTERPRISE_MEDIA_TYPE: NandaMediaType = NANDA_MEDIA_TYPE.AI_CATALOG;

/** ARD `type` vocabulary — the target of NANDA→ARD media-type mapping. */
export const ARD_MEDIA_TYPE = {
  AI_REGISTRY: 'application/ai-registry+json',
  A2A_CARD:    'application/a2a-agent-card+json',
  MCP_CARD:    'application/mcp-server-card+json',
  AI_SKILL:    'application/ai-skill+md',
} as const;
