/**
 * Maps NANDA's internal `media_type` values to ARD's `type` vocabulary, so
 * results from /api/ard/* are legible to any ARD-aware client (ora.ai, etc).
 * Best-effort for the two NANDA types without a clean 1:1 ARD equivalent
 * (dns-aid has no resource-level ARD type; agent-skill-archive isn't in
 * ARD's mediaTypes list) — passthrough for anything unrecognized.
 */
import { ARD_MEDIA_TYPE, NANDA_MEDIA_TYPE } from './mediaTypes.js';

export const NANDA_TO_ARD_TYPE: Record<string, string> = {
  [NANDA_MEDIA_TYPE.AI_CATALOG]:   ARD_MEDIA_TYPE.AI_REGISTRY,
  [NANDA_MEDIA_TYPE.ANS_REGISTRY]: ARD_MEDIA_TYPE.AI_REGISTRY,
  [NANDA_MEDIA_TYPE.DNS_AID]:      ARD_MEDIA_TYPE.A2A_CARD,
  [NANDA_MEDIA_TYPE.A2A_CARD]:     ARD_MEDIA_TYPE.A2A_CARD,
  [NANDA_MEDIA_TYPE.MCP_CARD]:     ARD_MEDIA_TYPE.MCP_CARD,
  [NANDA_MEDIA_TYPE.AGENT_SKILL]:  ARD_MEDIA_TYPE.AI_SKILL,
};

export function toArdType(nandaMediaType: string): string {
  return NANDA_TO_ARD_TYPE[nandaMediaType] ?? nandaMediaType;
}
