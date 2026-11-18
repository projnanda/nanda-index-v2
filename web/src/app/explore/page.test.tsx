// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExplorePage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/explore" }));

const api = vi.hoisted(() => ({ listIndexRecords: vi.fn(async () => []) }));
vi.mock("@/lib/nanda-api", () => ({ listIndexRecords: api.listIndexRecords }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState(null, "", "/explore");
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

// ── Shareable view ──────────────────────────────────────────────────────────
// Filters, page and the open entry live in the address bar.

const SHARED_PERSONAL = "urn:air:host39.org:personal:ada@example.org";

// Twelve personal MCP entries: two pages of results, one with a personal identifier.
const SHARED_ENTRIES = Array.from({ length: 12 }, (_, i) => ({
  ...prodEntry(i === 10 ? SHARED_PERSONAL : `urn:air:example.org:agent:${i}`, MCP, { resolutionRole: "personal-agent-card" }),
  displayName: `Resource ${i}`,
}));

const query = () => new URLSearchParams(window.location.search);
const fragment = () => new URLSearchParams(window.location.hash.slice(1));
const checkbox = (name: RegExp) => screen.getByRole("checkbox", { name }) as HTMLInputElement;
const searchBox = () => screen.getByRole("textbox", { name: "Search" }) as HTMLInputElement;

async function renderShared(address = "/explore") {
  window.history.replaceState(null, "", address);
  api.listIndexRecords.mockResolvedValue(SHARED_ENTRIES as never);
  await act(async () => root.render(<ExplorePage />));
}

describe("explore shareable view", () => {
  it("restores facets, page and a selected personal entry from a link", async () => {
    await renderShared(`/explore?owner=personal&protocol=mcp&page=2#entry=${encodeURIComponent(SHARED_PERSONAL)}`);
    expect(screen.getByRole("dialog", { name: "Resource 10 details" })).toBeTruthy();
    expect(checkbox(/Personal/).checked).toBe(true);
    expect(checkbox(/MCP/).checked).toBe(true);
    expect(checkbox(/SMB/).checked).toBe(false);
    // Page 2 holds entries 9 to 11.
    expect(screen.queryByRole("button", { name: "Resource 0" })).toBeNull();
    expect(screen.getByRole("button", { name: "Resource 9" })).toBeTruthy();
  });

  it("links the open entry to its trace, keeping a personal identifier in the fragment", async () => {
    await renderShared(`/explore#entry=${encodeURIComponent(SHARED_PERSONAL)}`);
    const link = screen.getByRole("link", { name: "Resolve this identifier" }) as HTMLAnchorElement;
    expect(new URL(link.href).pathname).toBe("/resolve");
    expect(new URL(link.href).search).toBe("");
    expect(new URLSearchParams(new URL(link.href).hash.slice(1)).get("urn")).toBe(SHARED_PERSONAL);
    // The note sits in the drawer, next to the link it describes.
    expect(screen.getByRole("dialog").textContent).toContain("remain in browser history and shared links");
  });

  it("links an ordinary entry to its trace through the query string", async () => {
    await renderShared("/explore?entry=urn%3Aair%3Aexample.org%3Aagent%3A0");
    const link = screen.getByRole("link", { name: "Resolve this identifier" }) as HTMLAnchorElement;
    expect(new URL(link.href).searchParams.get("urn")).toBe("urn:air:example.org:agent:0");
    expect(container.textContent).not.toContain("remain in browser history and shared links");
  });

  it("ignores filter values the page does not offer", async () => {
    await renderShared("/explore?owner=nobody,personal&protocol=toString&page=-4");
    expect(checkbox(/Personal/).checked).toBe(true);
    expect(container.querySelectorAll("[data-facet-option] input:checked")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Resource 0" })).toBeTruthy();
  });

  it("puts toggled facets in the address in a stable order, and returns to page 1", async () => {
    await renderShared("/explore?page=2");
    fireEvent.click(checkbox(/SMB/));
    fireEvent.click(checkbox(/Personal/));
    expect(query().get("owner")).toBe("personal,smb");
    expect(query().get("page")).toBeNull();
    fireEvent.click(checkbox(/SMB/));
    expect(query().get("owner")).toBe("personal");
  });

  it("restores the previous filters with the back button", async () => {
    await renderShared();
    fireEvent.click(checkbox(/Personal/));
    fireEvent.click(checkbox(/MCP/));
    act(() => window.history.back());
    await waitFor(() => expect(checkbox(/MCP/).checked).toBe(false));
    expect(checkbox(/Personal/).checked).toBe(true);
  });

  it("opens and closes an entry through the address, so back reopens it", async () => {
    await renderShared();
    fireEvent.click(screen.getByRole("button", { name: "Resource 0" }));
    expect(query().get("entry")).toBe("urn:air:example.org:agent:0");
    expect(screen.getByRole("dialog", { name: "Resource 0 details" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(query().get("entry")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Resource 0 details" })).toBeNull();
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Resource 0 details" })).toBeTruthy());
  });

  it("keeps the page in the address, omitting it for page 1", async () => {
    await renderShared();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(query().get("page")).toBe("2");
    expect(screen.queryByRole("button", { name: "Resource 0" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(query().get("page")).toBeNull();
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByRole("button", { name: "Resource 9" })).toBeTruthy());
  });

  it("filters as you type and writes the search to the address once typing pauses", async () => {
    await renderShared();
    vi.useFakeTimers();
    try {
      const replace = vi.spyOn(window.history, "replaceState");
      for (const value of ["R", "Re", "Resource 1"]) {
        fireEvent.change(searchBox(), { target: { value } });
        act(() => vi.advanceTimersByTime(250));
      }
      // The list narrows at once. Browsers cap how often the address may
      // change, so it is left alone while the typing continues.
      expect(screen.queryByRole("button", { name: "Resource 0" })).toBeNull();
      expect(screen.getByRole("button", { name: "Resource 10" })).toBeTruthy();
      expect(replace).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(50));
      expect(query().get("q")).toBe("Resource 1");
      expect(replace).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("keeps a typed email search in the fragment and explains what that means", async () => {
    await renderShared();
    fireEvent.change(searchBox(), { target: { value: "ada@example.org" } });
    await waitFor(() => expect(fragment().get("q")).toBe("ada@example.org"));
    expect(query().get("q")).toBeNull();
    expect(screen.getByRole("button", { name: "Resource 10" })).toBeTruthy();
    expect(container.textContent).toContain("remain in browser history and shared links");
  });

  it("returns to page 1 as soon as the search changes", async () => {
    await renderShared("/explore?page=2");
    fireEvent.change(searchBox(), { target: { value: "Resource" } });
    expect(query().get("page")).toBeNull();
  });

  it("fills the search box from a link and from back navigation", async () => {
    await renderShared("/explore?q=Resource+1");
    expect(searchBox().value).toBe("Resource 1");
    expect(cards()).toHaveLength(3);
    fireEvent.click(checkbox(/Personal/));
    act(() => window.history.replaceState(null, "", "/explore"));
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    await waitFor(() => expect(searchBox().value).toBe(""));
    expect(cards()).toHaveLength(9);
  });

  it("clears the address along with the filters", async () => {
    await renderShared("/explore?owner=personal&protocol=mcp&q=Resource&page=2");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(window.location.search).toBe("");
    expect(searchBox().value).toBe("");
    expect(container.querySelectorAll("[data-facet-option] input:checked")).toHaveLength(0);
  });

  it("says so when a shared entry is no longer in the index", async () => {
    await renderShared("/explore?entry=urn%3Aair%3Aexample.org%3Aagent%3Amissing");
    expect(screen.getByRole("status").textContent).toBe("This shared entry is not available in the index.");
    expect(screen.queryByRole("link", { name: "Resolve this identifier" })).toBeNull();
  });

  it("does not report a shared entry as missing while the index is still loading", async () => {
    window.history.replaceState(null, "", "/explore?entry=urn%3Aair%3Aexample.org%3Aagent%3A0");
    api.listIndexRecords.mockReturnValue(pending());
    await act(async () => root.render(<ExplorePage />));
    expect(container.textContent).not.toContain("not available in the index");
  });
});
