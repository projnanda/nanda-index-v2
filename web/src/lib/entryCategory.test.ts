import { describe, expect, it } from "vitest";
import type { IndexCatalogEntry } from "@/lib/nanda-types";
import { discoveryMethodOf, inSelection, ownerOf, protocolOf, tallyFacet, type Owner } from "./entryCategory";

const A2A = "application/a2a-agent-card+json";
const MCP = "application/mcp-server-card+json";
const SKILL = "application/agentskill+zip";
const CATALOG = "application/ai-catalog+json";
const REGISTRY = "application/ai-registry+json";

const ALL_TYPES = [A2A, MCP, SKILL, CATALOG, REGISTRY];

interface EntryOptions {
  role?: string;
  tags?: string[];
  url?: string;
  data?: Record<string, unknown>;
}

/** A minimal index entry; `role` becomes its org.projectnanda resolutionRole. */
function entry(type: string, opts: EntryOptions = {}): IndexCatalogEntry {
  return {
    identifier: "urn:air:example.com:agent:test",
    displayName: "Test",
    type,
    tags: opts.tags ?? [],
    updatedAt: "2026-10-27T00:00:00.000Z",
    extensions: opts.role ? { "org.projectnanda": { resolutionRole: opts.role } } : {},
    ...(opts.url ? { url: opts.url } : {}),
    ...(opts.data ? { data: opts.data } : {}),
  };
}

describe("protocolOf", () => {
  it.each([
    [A2A, "a2a"],
    [MCP, "mcp"],
    [SKILL, "skill"],
    [CATALOG, "catalog"],
    [REGISTRY, "catalog"],
  ])("maps %s to %s", (type, expected) => {
    expect(protocolOf(entry(type))).toBe(expected);
  });

  it("ignores media type parameters and letter case", () => {
    expect(protocolOf(entry("Application/MCP-Server-Card+json; charset=utf-8"))).toBe("mcp");
  });

  it("returns null for an unrecognised media type", () => {
    expect(protocolOf(entry("application/json"))).toBeNull();
  });

  // The #63 bug: a personal entry's protocol used to be hidden by its owner.
  it.each(["personal-agent-card", "smb-agent-card", "nested-ai-catalog", "dns-svcb-pointer"])(
    "is not affected by the %s role",
    (role) => {
      expect(protocolOf(entry(MCP, { role }))).toBe("mcp");
    },
  );

  it("is not affected by tags", () => {
    expect(protocolOf(entry(MCP, { tags: ["personal-agent", "smb"] }))).toBe("mcp");
  });
});

describe("ownerOf", () => {
  describe("by resolution role", () => {
    it.each([
      ["personal-agent-card", "personal"],
      ["smb-agent-card", "smb"],
      ["nested-ai-catalog", "enterprise"],
    ])("maps the %s role to %s", (role, expected) => {
      expect(ownerOf(entry(A2A, { role }))).toBe(expected);
    });

    it.each(ALL_TYPES)("keeps a personal entry Personal when it publishes %s", (type) => {
      expect(ownerOf(entry(type, { role: "personal-agent-card" }))).toBe("personal");
    });

    // Any domain owner can publish through DNS SVCB, so the role says nothing about who they are.
    it("leaves a DNS SVCB pointer unspecified", () => {
      expect(ownerOf(entry(A2A, { role: "dns-svcb-pointer" }))).toBeNull();
    });

    it("leaves an unknown role unspecified", () => {
      expect(ownerOf(entry(A2A, { role: "ard-endpoint" }))).toBeNull();
    });
  });

  describe("by tags, when the role does not decide", () => {
    it.each([
      ["personal-agent", "personal"],
      ["email-identity", "personal"],
      ["smb", "smb"],
      ["enterprise", "enterprise"],
    ])("maps the %s tag to %s", (tag, expected) => {
      expect(ownerOf(entry(A2A, { tags: [tag] }))).toBe(expected);
    });

    it("matches tags case-insensitively", () => {
      expect(ownerOf(entry(A2A, { tags: ["Personal-Agent"] }))).toBe("personal");
      expect(ownerOf(entry(A2A, { tags: ["SMB"] }))).toBe("smb");
    });

    it("applies the tag fallback to every protocol", () => {
      expect(ownerOf(entry(MCP, { tags: ["smb"] }))).toBe("smb");
    });

    it("lets a DNS SVCB pointer fall back to its tags", () => {
      expect(ownerOf(entry(A2A, { role: "dns-svcb-pointer", tags: ["smb"] }))).toBe("smb");
    });

    it("prefers a personal tag to an SMB tag, and an SMB tag to an enterprise tag", () => {
      expect(ownerOf(entry(A2A, { tags: ["enterprise", "smb", "personal-agent"] }))).toBe("personal");
      expect(ownerOf(entry(A2A, { tags: ["enterprise", "smb"] }))).toBe("smb");
    });

    it("returns null for an untagged card with no role", () => {
      expect(ownerOf(entry(A2A))).toBeNull();
    });
  });

  describe("by protocol, when neither role nor tags decide", () => {
    it.each([CATALOG, REGISTRY])("treats a %s entry as Enterprise", (type) => {
      expect(ownerOf(entry(type))).toBe("enterprise");
    });

    it.each([A2A, MCP, SKILL])("does not infer an owner from %s", (type) => {
      expect(ownerOf(entry(type))).toBeNull();
    });
  });

  describe("precedence", () => {
    it("ranks the SMB role above conflicting tags", () => {
      expect(ownerOf(entry(A2A, { role: "smb-agent-card", tags: ["personal-agent"] }))).toBe("smb");
    });

    it("ranks the personal role above conflicting tags", () => {
      expect(ownerOf(entry(A2A, { role: "personal-agent-card", tags: ["smb"] }))).toBe("personal");
    });

    it("ranks the catalog role above conflicting tags", () => {
      expect(ownerOf(entry(CATALOG, { role: "nested-ai-catalog", tags: ["smb"] }))).toBe("enterprise");
    });

    it("ranks tags above the catalog protocol", () => {
      expect(ownerOf(entry(CATALOG, { tags: ["smb"] }))).toBe("smb");
    });
  });
});

describe("discoveryMethodOf", () => {
  it("reports DNS SVCB for a pointer entry, whatever else it carries", () => {
    expect(discoveryMethodOf(entry(CATALOG, { role: "dns-svcb-pointer", url: "https://example.com/c.json" }))).toBe("DNS SVCB");
  });

  it("reports Catalog for a catalog or registry entry", () => {
    expect(discoveryMethodOf(entry(CATALOG, { url: "https://example.com/c.json" }))).toBe("Catalog");
    expect(discoveryMethodOf(entry(REGISTRY))).toBe("Catalog");
  });

  it("reports a hosted resource when the entry has a URL", () => {
    expect(discoveryMethodOf(entry(A2A, { url: "https://example.com/card.json", data: { name: "x" } }))).toBe("Hosted resource");
  });

  it("reports an inline resource when the entry carries data and no URL", () => {
    expect(discoveryMethodOf(entry(A2A, { data: { name: "x" } }))).toBe("Inline resource");
  });

  it("reports custom discovery when the entry has neither", () => {
    expect(discoveryMethodOf(entry(A2A))).toBe("Custom discovery");
  });
});

describe("inSelection", () => {
  it("matches everything when nothing is selected", () => {
    expect(inSelection("mcp", new Set())).toBe(true);
    expect(inSelection(null, new Set())).toBe(true);
  });

  it("matches only selected values once something is selected", () => {
    const selected = new Set(["mcp", "skill"]);
    expect(inSelection("mcp", selected)).toBe(true);
    expect(inSelection("a2a", selected)).toBe(false);
  });

  it("excludes an unspecified value once something is selected", () => {
    expect(inSelection(null, new Set(["mcp"]))).toBe(false);
  });
});

describe("tallyFacet", () => {
  it("counts each value and keeps unspecified entries in the total", () => {
    const tally = tallyFacet<Owner>(["enterprise", "personal", "enterprise", null]);
    expect(tally.counts.get("enterprise")).toBe(2);
    expect(tally.counts.get("personal")).toBe(1);
    expect(tally.counts.get("smb")).toBeUndefined();
    expect(tally).toMatchObject({ unspecified: 1, total: 4 });
  });

  it("returns an empty tally for an empty index", () => {
    const tally = tallyFacet([]);
    expect(tally.counts.size).toBe(0);
    expect(tally).toMatchObject({ unspecified: 0, total: 0 });
  });
});
