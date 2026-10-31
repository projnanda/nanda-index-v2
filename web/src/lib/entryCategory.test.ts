import { expect, it } from "vitest";
import type { IndexCatalogEntry } from "./nanda-types";
import { ownerOf, protocolOf, discoveryMethodOf, matchesFacets } from "./entryCategory";
const entry = (type: string, role = "personal-agent-card"): IndexCatalogEntry => ({ identifier: "urn:air:example.org:agent:x", displayName: "Example", tags: [], type, updatedAt: "2026-01-01", extensions: { "org.projectnanda": { resolutionRole: role } } });
it.each(["personal-agent-card", "smb-agent-card", "dns-svcb-pointer"])("MCP protocol does not depend on ownership (%s)", (role) => {
  expect(protocolOf(entry("application/mcp-server-card+json", role))).toBe("mcp");
});
it("combines owner and protocol facets", () => {
  const mcp = entry("application/mcp-server-card+json");
  expect(ownerOf(mcp)).toBe("personal");
  expect(matchesFacets(mcp, new Set(["personal"]), new Set(["mcp"]))).toBe(true);
  expect(matchesFacets(mcp, new Set(["smb"]), new Set(["mcp"]))).toBe(false);
  expect(matchesFacets(mcp, new Set(["personal"]), new Set(["a2a"]))).toBe(false);
});
it("keeps discovery independent of protocol", () => {
  const dns = entry("application/a2a-agent-card+json", "dns-svcb-pointer");
  expect(discoveryMethodOf(dns)).toBe("DNS SVCB");
  expect(protocolOf(dns)).toBe("a2a");
});
it("does not guess unknown ownership or protocols", () => {
  expect(ownerOf(entry("application/json", "unknown"))).toBeNull();
  expect(protocolOf(entry("application/json"))).toBeNull();
  expect(matchesFacets(entry("application/json"), new Set(), new Set())).toBe(true);
});

it.each([
  ["application/a2a-agent-card+json", "a2a"],
  ["application/agentskill+zip", "skill"],
  ["application/ai-catalog+json", "catalog"],
  ["application/ai-registry+json", "catalog"],
  ["Application/MCP-Server-Card+Json; charset=utf-8", "mcp"],
])("classifies protocol %s", (type, protocol) => {
  expect(protocolOf(entry(type))).toBe(protocol);
});
it("matches alternatives within one facet and allows unfiltered facets", () => {
  const personal = entry("application/mcp-server-card+json");
  expect(matchesFacets(personal, new Set(["personal", "smb"]), new Set(["mcp", "skill"]))).toBe(true);
  expect(matchesFacets(personal, new Set(), new Set(["mcp"]))).toBe(true);
});
