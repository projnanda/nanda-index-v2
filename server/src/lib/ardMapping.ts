/**
 * Maps NANDA's internal `media_type` values to ARD's `type` vocabulary, so
 * results from /api/ard/* are legible to any ARD-aware client (ora.ai, etc).
 * Best-effort for the NANDA types without a clean 1:1 ARD equivalent
 * (agent-skill-archive isn't in ARD's mediaTypes list) — passthrough for
 * anything unrecognized.
 */
export const NANDA_TO_ARD_TYPE: Record<string, string> = {
  'application/ai-catalog+json':      'application/ai-registry+json',
  'application/ai-registry+json':     'application/ai-registry+json',
  'application/a2a-agent-card+json':  'application/a2a-agent-card+json',
  'application/mcp-server-card+json': 'application/mcp-server-card+json',
  'application/agentskill+zip':       'application/ai-skill+md',
};

export function toArdType(nandaMediaType: string): string {
  return NANDA_TO_ARD_TYPE[nandaMediaType] ?? nandaMediaType;
}
