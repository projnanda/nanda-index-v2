import type { IndexCatalogEntry } from "@/lib/nanda-types";
import { nandaField } from "@/lib/air";

export type Owner = "enterprise" | "smb" | "personal";
export type Protocol = "a2a" | "mcp" | "skill" | "catalog";

export const OWNER_LABELS: Record<Owner, string> = { enterprise: "Enterprise", smb: "SMB", personal: "Personal" };
export const PROTOCOL_LABELS: Record<Protocol, string> = { a2a: "A2A", mcp: "MCP", skill: "Agent Skill", catalog: "Catalog" };

/** Ownership and protocol are independent; a personal entry can publish MCP. */
export function ownerOf(record: IndexCatalogEntry): Owner | null {
  const role = nandaField(record, "resolutionRole");
  if (role === "personal-agent-card") return "personal";
  if (role === "smb-agent-card") return "smb";
  if (["nested-ai-catalog", "dns-svcb-pointer", "ard-endpoint"].includes(role ?? "")) return "enterprise";
  const tags = (record.tags ?? []).map((tag) => tag.toLowerCase());
  if (tags.includes("personal-agent") || tags.includes("email-identity")) return "personal";
  if (tags.includes("smb")) return "smb";
  if (tags.includes("enterprise") || protocolOf(record) === "catalog") return "enterprise";
  return null;
}

export function protocolOf(record: IndexCatalogEntry): Protocol | null {
  switch (record.type?.split(";", 1)[0].trim().toLowerCase()) {
    case "application/a2a-agent-card+json": return "a2a";
    case "application/mcp-server-card+json": return "mcp";
    case "application/agentskill+zip": return "skill";
    case "application/ai-catalog+json":
    case "application/ai-registry+json": return "catalog";
    default: return null;
  }
}

export function discoveryMethodOf(record: IndexCatalogEntry): string {
  if (nandaField(record, "resolutionRole") === "dns-svcb-pointer") return "DNS SVCB";
  if (protocolOf(record) === "catalog") return "Catalog";
  return record.url ? "Hosted resource" : record.data ? "Inline resource" : "Custom discovery";
}

export function matchesFacets(record: IndexCatalogEntry, owners: ReadonlySet<Owner>, protocols: ReadonlySet<Protocol>): boolean {
  const owner = ownerOf(record);
  const protocol = protocolOf(record);
  return (!owners.size || (owner !== null && owners.has(owner)))
    && (!protocols.size || (protocol !== null && protocols.has(protocol)));
}
