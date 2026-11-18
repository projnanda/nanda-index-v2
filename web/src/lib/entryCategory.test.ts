import { describe, expect, it } from "vitest";
import type { IndexCatalogEntry } from "@/lib/nanda-types";
import { categoryOf, tallyCategories } from "./entryCategory";

const A2A = "application/a2a-agent-card+json";
const MCP = "application/mcp-server-card+json";
const SKILL = "application/agentskill+zip";
const CATALOG = "application/ai-catalog+json";
const REGISTRY = "application/ai-registry+json";

const MEDIA_TYPE_CATEGORY: [type: string, expected: string][] = [
  [MCP, "mcp"],
  [SKILL, "skill"],
  [CATALOG, "enterprise"],
  [REGISTRY, "enterprise"],
];
const NON_PERSONAL_ROLES = ["smb-agent-card", "dns-svcb-pointer", "nested-ai-catalog"];

/** A minimal index entry; `role` becomes its org.projectnanda resolutionRole. */
function entry(type: string, opts: { role?: string; tags?: string[] } = {}): IndexCatalogEntry {
  return {
    identifier: "urn:air:example.com:agent:test",
    displayName: "Test",
    type,
    tags: opts.tags ?? [],
    updatedAt: "2026-10-27T00:00:00.000Z",
    extensions: opts.role ? { "org.projectnanda": { resolutionRole: opts.role } } : {},
  };
}

describe("categoryOf", () => {
  describe("personal entries", () => {
    it("files a personal MCP server card (a MessageBox) under Personal, not MCPs", () => {
      expect(categoryOf(entry(MCP, { role: "personal-agent-card" }))).toBe("personal");
    });

    it("files a personal skill under Personal, not Skills", () => {
      expect(categoryOf(entry(SKILL, { role: "personal-agent-card" }))).toBe("personal");
    });

    it("files a personal A2A agent card under Personal", () => {
      expect(categoryOf(entry(A2A, { role: "personal-agent-card" }))).toBe("personal");
    });
  });

  describe("by media type", () => {
    it.each(MEDIA_TYPE_CATEGORY)("files %s under %s", (type, expected) => {
      expect(categoryOf(entry(type))).toBe(expected);
    });

    // Only the personal role outranks media type.
    it.each(
      MEDIA_TYPE_CATEGORY.flatMap(([type, expected]) => NON_PERSONAL_ROLES.map((role) => [type, role, expected])),
    )("keeps %s with role %s under %s", (type, role, expected) => {
      expect(categoryOf(entry(type, { role }))).toBe(expected);
    });
  });

  describe("by resolution role", () => {
    it.each([
      ["dns-svcb-pointer", "dns-svcb"],
      ["smb-agent-card", "smb"],
    ])("files an A2A card with role %s under %s", (role, expected) => {
      expect(categoryOf(entry(A2A, { role }))).toBe(expected);
    });

    it("returns null for a role with no category of its own", () => {
      expect(categoryOf(entry(A2A, { role: "nested-ai-catalog" }))).toBeNull();
    });
  });

  describe("A2A cards without a role, by tags", () => {
    it.each([
      ["personal-agent", "personal"],
      ["email-identity", "personal"],
      ["smb", "smb"],
    ])("files a card tagged %s under %s", (tag, expected) => {
      expect(categoryOf(entry(A2A, { tags: [tag] }))).toBe(expected);
    });

    it("matches tags case-insensitively", () => {
      expect(categoryOf(entry(A2A, { tags: ["Personal-Agent"] }))).toBe("personal");
    });

    it("returns null for an untagged card", () => {
      expect(categoryOf(entry(A2A))).toBeNull();
    });
  });

  describe("precedence between role, media type and tags", () => {
    it("ranks a role above conflicting tags", () => {
      expect(categoryOf(entry(A2A, { role: "smb-agent-card", tags: ["personal-agent"] }))).toBe("smb");
    });

    it("ranks the personal role above conflicting tags", () => {
      expect(categoryOf(entry(A2A, { role: "personal-agent-card", tags: ["smb"] }))).toBe("personal");
    });

    it("never lets tags override media type", () => {
      expect(categoryOf(entry(MCP, { tags: ["personal-agent"] }))).toBe("mcp");
    });

    it("applies the tag fallback to A2A cards only", () => {
      expect(categoryOf(entry("application/json", { tags: ["personal-agent"] }))).toBeNull();
    });
  });

  it("returns null for an unrecognised media type", () => {
    expect(categoryOf(entry("application/json"))).toBeNull();
  });
});

describe("tallyCategories", () => {
  it("counts each category and keeps uncategorised entries in the total", () => {
    const tally = tallyCategories(["enterprise", "personal", "enterprise", null]);
    expect(tally.counts.get("enterprise")).toBe(2);
    expect(tally.counts.get("personal")).toBe(1);
    expect(tally.counts.get("skill")).toBeUndefined();
    expect(tally).toMatchObject({ uncategorised: 1, total: 4 });
  });

  it("returns an empty tally for an empty index", () => {
    const tally = tallyCategories([]);
    expect(tally.counts.size).toBe(0);
    expect(tally).toMatchObject({ uncategorised: 0, total: 0 });
  });
});
