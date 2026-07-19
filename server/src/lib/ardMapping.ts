/**
 * Maps NANDA's internal `media_type` values to ARD's `type` vocabulary, so
 * results from /api/ard/* are legible to any ARD-aware client (ora.ai, etc).
 * Best-effort for the two NANDA types without a clean 1:1 ARD equivalent
 * (dns-aid has no resource-level ARD type; agent-skill-archive isn't in
 * ARD's mediaTypes list) — passthrough for anything unrecognized.
 */
export const NANDA_TO_ARD_TYPE: Record<string, string> = {
  'application/ai-catalog+json':      'application/ai-registry+json',
  'application/vnd.dns-aid+json':     'application/a2a-agent-card+json',
  'application/a2a-agent-card+json':  'application/a2a-agent-card+json',
  'application/mcp-server-card+json': 'application/mcp-server-card+json',
  'application/agentskill+zip':       'application/ai-skill+md',
};

export function toArdType(nandaMediaType: string): string {
  return NANDA_TO_ARD_TYPE[nandaMediaType] ?? nandaMediaType;
}
