// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExplorePage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/explore" }));

const api = vi.hoisted(() => ({ listIndexRecords: vi.fn(async () => []) }));
vi.mock("@/lib/nanda-api", () => ({ listIndexRecords: api.listIndexRecords }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  api.listIndexRecords.mockReset().mockResolvedValue([]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("explore page structure", () => {
  it("titles the page with a single h1 that comes before every other heading", async () => {
    await act(async () => root.render(<ExplorePage />));
    const headings = Array.from(container.querySelectorAll("h1, h2, h3, h4, h5, h6"));
    expect(headings[0]?.tagName).toBe("H1");
    expect(headings[0]?.textContent).toBe("Explore");
    expect(headings.filter((h) => h.tagName === "H1")).toHaveLength(1);
  });

  it("explains what the page is for directly under the title", async () => {
    await act(async () => root.render(<ExplorePage />));
    const h1 = container.querySelector("h1")!;
    const descriptor = h1.nextElementSibling;
    expect(descriptor?.tagName).toBe("P");
    expect(descriptor?.textContent).toMatch(/^Browse every entry listed in the index\./);
  });

  it("renders no main element of its own, so the layout's main stays the only landmark", async () => {
    await act(async () => root.render(<ExplorePage />));
    expect(container.querySelector("main")).toBeNull();
  });

  it("still loads the index and shows the empty state inside the shell", async () => {
    await act(async () => root.render(<ExplorePage />));
    expect(api.listIndexRecords).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("No index records are registered yet.");
  });
});

// ── Owner and protocol facets ───────────────────────────────────────────────
// Entries shaped exactly like production GET /api/v1/index (Nov 2026).

const A2A = "application/a2a-agent-card+json";
const MCP = "application/mcp-server-card+json";
const CATALOG = "application/ai-catalog+json";

function prodEntry(identifier: string, type: string, ext: Record<string, unknown>, tags: string[] = []) {
  const domain = identifier.split(":")[2] ?? null;
  return {
    identifier,
    displayName: domain ?? identifier,
    type,
    tags,
    updatedAt: "2026-06-17T08:08:06.212Z",
    description: "Production-shaped entry",
    extensions: {
      "org.projectnanda": {
        orgId: identifier,
        status: "active",
        ttlSeconds: 86400,
        emailVerified: true,
        emailVerifiedAt: null,
        domainVerifiedAt: null,
        cardValidation: null,
        domainVerified: true,
        createdAt: "2026-06-17T07:14:35.111Z",
        domain,
        representativeQueries: [],
        ...ext,
      },
    },
  };
}

const PERSONAL_MCP = "urn:air:host39.org:personal:jane@example.com";
const PERSONAL_A2A = "urn:air:host39.org:personal:sam@example.com";
const PLAIN_MCP = "urn:air:tools.example.com:mcp:search";
const SVCB_POINTER = "urn:air:svcb.example.org:agent:pointer";

const PROD_ENTRIES = [
  prodEntry("urn:air:travel26.net:catalog:root", CATALOG,
    { resolutionRole: "nested-ai-catalog", preferredDiscovery: "ai-catalog" }, ["enterprise", "travel"]),
  prodEntry("urn:air:astrocity.org:catalog:root", CATALOG, {}, ["general ai"]),
  // Any domain owner can publish through DNS SVCB, so this has no owner.
  prodEntry(SVCB_POINTER, A2A, { resolutionRole: "dns-svcb-pointer" }),
  prodEntry("urn:air:bakery.example.com:agent:orders", A2A, { resolutionRole: "smb-agent-card" }, ["smb"]),
  prodEntry(PERSONAL_MCP, MCP, { resolutionRole: "personal-agent-card", domain: null }, ["personal-agent"]),
  prodEntry(PERSONAL_A2A, A2A, { resolutionRole: "personal-agent-card", domain: null }, ["personal-agent"]),
  prodEntry(PLAIN_MCP, MCP, {}),
  // No owner: an A2A card with no resolutionRole and no telling tags.
  prodEntry("urn:air:nandadaily.org:agent:nanda-daily", A2A, {}),
];

const pending = () => new Promise<never>(() => {});

function facetOption(label: string): HTMLElement {
  const options = Array.from(container.querySelectorAll<HTMLElement>("[data-facet-option]"));
  const option = options.find((o) => o.querySelector("[data-facet-label]")?.textContent === label);
  if (!option) throw new Error(`no facet option labelled ${label}`);
  return option;
}

const countOf = (label: string) => facetOption(label).querySelector("[data-facet-count]")?.textContent ?? "";
const allCounts = () => Array.from(container.querySelectorAll("[data-facet-count]")).map((c) => c.textContent);
const cards = () => Array.from(container.querySelectorAll<HTMLElement>("article"));
const cardFor = (identifier: string) => cards().find((card) => card.textContent?.includes(identifier));

async function toggle(label: string) {
  await act(async () => facetOption(label).querySelector("input")!.click());
}

async function renderLoaded() {
  api.listIndexRecords.mockResolvedValue(PROD_ENTRIES as never);
  await act(async () => root.render(<ExplorePage />));
}

describe("explore facets", () => {
  it("groups the options under Owner and Protocol, with no combined Category group", async () => {
    await renderLoaded();
    const legends = Array.from(container.querySelectorAll("fieldset > legend")).map((l) => l.textContent);
    expect(legends).toEqual(["Owner", "Protocol"]);
    const labels = (legend: string) =>
      Array.from(container.querySelectorAll(`fieldset[data-facet="${legend}"] [data-facet-label]`)).map((l) => l.textContent);
    expect(labels("owner")).toEqual(["Enterprise", "SMB", "Personal"]);
    expect(labels("protocol")).toEqual(["A2A", "MCP", "Agent Skill", "Catalog"]);
  });

  it("does not show a count of 0 for any option before the index has loaded", async () => {
    api.listIndexRecords.mockReturnValue(pending());
    await act(async () => root.render(<ExplorePage />));
    expect(container.querySelectorAll("[data-facet-option]")).toHaveLength(7);
    expect(allCounts()).not.toContain("0");
  });

  it("marks the in-flight skeleton as a loading status rather than result tiles", async () => {
    api.listIndexRecords.mockReturnValue(pending());
    await act(async () => root.render(<ExplorePage />));
    const status = container.querySelector('[role="status"]');
    expect(status?.getAttribute("aria-busy")).toBe("true");
    expect(status?.textContent).toContain("Loading entries");
  });

  it("counts owners and protocols independently from a production-shaped payload", async () => {
    await renderLoaded();
    expect(countOf("Enterprise")).toBe("2");
    expect(countOf("SMB")).toBe("1");
    expect(countOf("Personal")).toBe("2");
    expect(countOf("A2A")).toBe("4");
    expect(countOf("MCP")).toBe("2");
    expect(countOf("Agent Skill")).toBe("0");
    expect(countOf("Catalog")).toBe("2");
    expect(cards()).toHaveLength(PROD_ENTRIES.length);
  });

  it("returns every entry with an MCP media type when MCP is selected, personal ones included", async () => {
    await renderLoaded();
    await toggle("MCP");
    expect(cards()).toHaveLength(2);
    expect(cardFor(PERSONAL_MCP)).toBeDefined();
    expect(cardFor(PLAIN_MCP)).toBeDefined();
  });

  it("combines the two groups with AND: Personal + MCP shows only the personal MCP entry", async () => {
    await renderLoaded();
    await toggle("Personal");
    expect(cards()).toHaveLength(2);
    await toggle("MCP");
    expect(cards()).toHaveLength(1);
    expect(cardFor(PERSONAL_MCP)).toBeDefined();
  });

  it("combines choices within a group with OR", async () => {
    await renderLoaded();
    await toggle("Personal");
    await toggle("SMB");
    expect(cards()).toHaveLength(3);
  });

  it("unticking an option removes its filter", async () => {
    await renderLoaded();
    await toggle("MCP");
    await toggle("MCP");
    expect(cards()).toHaveLength(PROD_ENTRIES.length);
  });

  it("counts each group against the other group's selection, so a count predicts the result", async () => {
    await renderLoaded();
    await toggle("Personal");
    expect(countOf("MCP")).toBe("1");
    expect(countOf("A2A")).toBe("1");
    expect(countOf("Catalog")).toBe("0");
    // A group's own selection does not narrow its own counts.
    expect(countOf("Enterprise")).toBe("2");
    await toggle("MCP");
    expect(countOf("Personal")).toBe("1");
    expect(countOf("Enterprise")).toBe("0");
  });

  it("de-emphasises options that would return no entries", async () => {
    await renderLoaded();
    expect(facetOption("Agent Skill").getAttribute("data-empty")).toBe("true");
    expect(facetOption("Enterprise").getAttribute("data-empty")).toBe("false");
  });

  it("reports the total, and the entries with no owner, instead of silently dropping them", async () => {
    await renderLoaded();
    expect(container.querySelector("[data-entry-summary]")?.textContent).toBe("8 entries");
    const unspecified = (facet: string) =>
      container.querySelector(`fieldset[data-facet="${facet}"] [data-facet-unspecified]`)?.textContent ?? null;
    expect(unspecified("owner")).toBe("3 unspecified");
    expect(unspecified("protocol")).toBeNull();
  });

  it("clears both groups with Clear filters", async () => {
    await renderLoaded();
    await toggle("Personal");
    await toggle("MCP");
    const clear = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Clear filters")!;
    await act(async () => clear.click());
    expect(cards()).toHaveLength(PROD_ENTRIES.length);
    expect(container.querySelectorAll("[data-facet-option] input:checked")).toHaveLength(0);
  });

  it("labels each card with its owner, its protocol and how it is discovered", async () => {
    await renderLoaded();
    const badges = (identifier: string) =>
      Array.from(cardFor(identifier)!.querySelectorAll("[data-badge]")).map((b) => b.textContent);
    expect(badges(PERSONAL_MCP)).toEqual(["Personal", "MCP"]);
    expect(badges(PLAIN_MCP)).toEqual(["MCP"]);
    expect(badges(SVCB_POINTER)).toEqual(["A2A"]);
    expect(cardFor(SVCB_POINTER)!.textContent).toContain("Discovery: DNS SVCB");
    expect(cardFor(PERSONAL_MCP)!.textContent).not.toContain("DNS SVCB");
  });

  it("shows the error state, not zeros or blank tiles, when the index fails to load", async () => {
    api.listIndexRecords.mockRejectedValue(new Error("Failed to fetch"));
    await act(async () => root.render(<ExplorePage />));
    expect(container.textContent).toContain("Failed to fetch");
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
    expect(allCounts()).not.toContain("0");
  });
});
