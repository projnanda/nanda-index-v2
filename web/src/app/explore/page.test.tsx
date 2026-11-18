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

// ── Category counts ─────────────────────────────────────────────────────────
// Entries shaped exactly like production GET /api/v1/index (Nov 2026).

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

const PROD_ENTRIES = [
  prodEntry("urn:air:travel26.net:catalog:root", "application/ai-catalog+json",
    { resolutionRole: "nested-ai-catalog", preferredDiscovery: "ai-catalog" }, ["enterprise", "travel"]),
  prodEntry("urn:air:astrocity.org:catalog:root", "application/ai-catalog+json", {}, ["general ai"]),
  prodEntry("urn:air:svcb.example.org:agent:pointer", "application/a2a-agent-card+json",
    { resolutionRole: "dns-svcb-pointer" }),
  prodEntry("urn:air:bakery.example.com:agent:orders", "application/a2a-agent-card+json",
    { resolutionRole: "smb-agent-card" }, ["smb"]),
  prodEntry("urn:air:host39.org:personal:jane@example.com", "application/mcp-server-card+json",
    { resolutionRole: "personal-agent-card", domain: null }, ["personal-agent"]),
  // Fits no category: an A2A card with no resolutionRole and no telling tags.
  prodEntry("urn:air:nandadaily.org:agent:nanda-daily", "application/a2a-agent-card+json", {}),
];

const pending = () => new Promise<never>(() => {});

function categoryRow(label: string): HTMLElement {
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-category]"));
  const row = rows.find((r) => r.querySelector("[data-category-label]")?.textContent === label);
  if (!row) throw new Error(`no category row labelled ${label}`);
  return row;
}

const countOf = (label: string) => categoryRow(label).querySelector("[data-category-count]")?.textContent ?? "";
const allCounts = () => Array.from(container.querySelectorAll("[data-category-count]")).map((c) => c.textContent);

describe("explore category counts", () => {
  it("does not show a count of 0 for every category before the index has loaded", async () => {
    api.listIndexRecords.mockReturnValue(pending());
    await act(async () => root.render(<ExplorePage />));
    expect(container.querySelectorAll("[data-category]")).toHaveLength(6);
    expect(allCounts()).not.toContain("0");
  });

  it("marks the in-flight skeleton as a loading status rather than result tiles", async () => {
    api.listIndexRecords.mockReturnValue(pending());
    await act(async () => root.render(<ExplorePage />));
    const status = container.querySelector('[role="status"]');
    expect(status?.getAttribute("aria-busy")).toBe("true");
    expect(status?.textContent).toContain("Loading entries");
  });

  it("counts live entries from a production-shaped payload", async () => {
    api.listIndexRecords.mockResolvedValue(PROD_ENTRIES as never);
    await act(async () => root.render(<ExplorePage />));
    expect(countOf("Enterprise")).toBe("2");
    expect(countOf("DNS SVCB")).toBe("1");
    expect(countOf("SMBs")).toBe("1");
    expect(countOf("Personal")).toBe("1");
    expect(container.querySelectorAll("article")).toHaveLength(PROD_ENTRIES.length);
  });

  it("de-emphasises categories that have no entries", async () => {
    api.listIndexRecords.mockResolvedValue(PROD_ENTRIES as never);
    await act(async () => root.render(<ExplorePage />));
    expect(categoryRow("Skills").getAttribute("data-empty")).toBe("true");
    expect(categoryRow("Enterprise").getAttribute("data-empty")).toBe("false");
  });

  it("reports entries that fit no category instead of silently dropping them", async () => {
    api.listIndexRecords.mockResolvedValue(PROD_ENTRIES as never);
    await act(async () => root.render(<ExplorePage />));
    const summary = container.querySelector("[data-category-summary]")?.textContent ?? "";
    expect(summary).toContain("6 entries");
    expect(summary).toContain("1 uncategorised");
  });

  it("shows the error state, not zeros or blank tiles, when the index fails to load", async () => {
    api.listIndexRecords.mockRejectedValue(new Error("Failed to fetch"));
    await act(async () => root.render(<ExplorePage />));
    expect(container.textContent).toContain("Failed to fetch");
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
    expect(allCounts()).not.toContain("0");
  });
});
