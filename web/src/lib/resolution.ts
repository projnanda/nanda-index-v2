import type { IndexRecord } from "@/lib/nanda-types";

// Pure helpers for presenting an IndexRecord as a NandaIndex *resolution record*
// (the switchboard view): what discovery mechanism it routes through, what it
// targets, and the `org.projectnanda.*` routing/governance metadata.
//
// Everything here is side-effect free and returns new values — safe to unit
// test in isolation and safe to call during render.

const PROJECT_NANDA_PREFIX = "org.projectnanda.";

// ── media_type → human label for the target it points at ──────────────────────
// Unknown / emerging types (telecom, IoT, sovereign, …) fall back to "Target"
// rather than breaking, mirroring the paper's "absorb innovation without
// requiring conformance".
const TARGET_LABEL: Record<string, string> = {
  "application/ai-catalog+json": "Catalog URL",
  "application/a2a-agent-card+json": "Agent card",
  "application/mcp-server-card+json": "MCP server",
  "application/agentskill+zip": "Skill bundle",
  "application/vnd.dns-aid+json": "DNS-AID pointer",
};

export function targetLabel(mediaType?: string | null): string {
  return (mediaType && TARGET_LABEL[mediaType]) || "Target";
}

// ── org.projectnanda.preferredDiscovery → human label ─────────────────────────
const DISCOVERY_LABEL: Record<string, string> = {
  "ai-catalog": "AI Catalog",
  "dns-aid": "DNS-AID",
  nandaindex: "NandaIndex (hosted card)",
  ard: "ARD directory",
};

export function discoveryLabel(value?: string | null): string | null {
  if (!value) return null;
  return DISCOVERY_LABEL[value] ?? value;
}

// ── org.projectnanda.resolutionRole → human label ─────────────────────────────
const ROLE_LABEL: Record<string, string> = {
  "nested-ai-catalog": "Nested AI Catalog",
  "dns-aid-pointer": "DNS-AID pointer",
  "smb-agent-card": "SMB agent card",
  "personal-agent-card": "Personal agent card",
  "ard-endpoint": "ARD endpoint",
  "optional-fallback-entry": "Optional fallback entry",
  "federated-pointer": "Federated pointer",
};

export function roleLabel(value?: string | null): string | null {
  if (!value) return null;
  return ROLE_LABEL[value] ?? humanize(value);
}

/** Headline shown as "Resolves via …". Falls back to the media-type target. */
export function resolutionHeadline(record: IndexRecord): string {
  return discoveryLabel(metaString(record, "preferredDiscovery")) ?? targetLabel(record.media_type);
}

// ── metadata access ───────────────────────────────────────────────────────────

/** Read an `org.projectnanda.<key>` metadata string, or null. */
export function metaString(record: IndexRecord, key: string): string | null {
  const value = record.metadata?.[PROJECT_NANDA_PREFIX + key];
  return typeof value === "string" ? value : null;
}

export interface KeyValue {
  key: string;
  label: string;
  value: string;
}

/**
 * Every `org.projectnanda.*` entry as label/value pairs, prefix stripped, minus
 * keys already surfaced prominently elsewhere. This is the catch-all that keeps
 * fields like nandaIndexRole / authoritativeSystem visible without a JSON dump.
 */
export function projectNandaMeta(record: IndexRecord, skip: readonly string[] = []): KeyValue[] {
  const meta = record.metadata;
  if (!meta) return [];
  const skipSet = new Set(skip.map((k) => PROJECT_NANDA_PREFIX + k));
  return Object.entries(meta)
    .filter(([k]) => k.startsWith(PROJECT_NANDA_PREFIX) && !skipSet.has(k))
    .map(([k, v]) => ({
      key: k,
      label: labelizeKey(k.slice(PROJECT_NANDA_PREFIX.length)),
      value: stringifyValue(v),
    }));
}

/** Inline routing data (`data`) as label/value pairs — used for DNS-AID pointers. */
export function dataEntries(record: IndexRecord): KeyValue[] {
  const data = record.data;
  if (!data) return [];
  return Object.entries(data).map(([k, v]) => ({
    key: k,
    label: labelizeKey(k),
    value: stringifyValue(v),
  }));
}

// ── string helpers ─────────────────────────────────────────────────────────────

/** "payment_or_session_token_required" → "Payment or session token required". */
export function humanize(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** "runtime.provider" / "nandaIndexRole" → "Runtime provider" / "Nanda index role". */
function labelizeKey(key: string): string {
  const spaced = key
    .replace(/\./g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
