import { describe, expect, it, vi } from "vitest";
import { CatalogEntryNotFound, planRegistryHop, resolveRegistryHop } from "./catalogHop";
import type { ResolveResponse } from "./nanda-types";

const CATALOG = "application/ai-catalog+json";
const CARD = "application/a2a-agent-card+json";

function resolved(locator: string, match: "exact" | "publisher", url: string | undefined, type = CATALOG): ResolveResponse {
  return {
    locator,
    identifier: locator.split(":").at(-1)!,
    match,
    entry: { identifier: locator, displayName: "x", type, url } as ResolveResponse["entry"],
  };
}

const doc = (...identifiers: string[]) => ({
  specVersion: "1.0",
  entries: identifiers.map((identifier) => ({ identifier, displayName: identifier, mediaType: CARD, url: `https://cards/${identifier}` })),
});

/** A fetcher serving `routes`; any other URL fails like a 404. */
function fetcher(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    if (url in routes) return routes[url];
    throw new Error(`404 ${url}`);
  });
}

describe("planRegistryHop", () => {
  it("fetches a single-resource entry as-is", () => {
    const plan = planRegistryHop(resolved("urn:air:a.com:agent:x", "exact", "https://a.com/card.json", CARD));
    expect(plan).toEqual({ kind: "entry", steps: [{ url: "https://a.com/card.json", shape: "entry" }] });
  });

  it("lists a catalog identifier instead of appending /agents/<short-name> (#51)", () => {
    expect(planRegistryHop(resolved("urn:air:travel26.net:catalog:root", "exact", "https://travel26.net/api")).steps).toEqual([
      { url: "https://travel26.net/api/agents", shape: "document" },
      { url: "https://travel26.net/.well-known/ai-catalog.json", shape: "document" },
    ]);
    expect(planRegistryHop(resolved("urn:air:noinfra.ai:catalog:root", "exact", "https://noinfra.ai/.well-known/ai-catalog.json")))
      .toEqual({ kind: "catalog", steps: [{ url: "https://noinfra.ai/.well-known/ai-catalog.json", shape: "document" }] });
  });

  it("looks a publisher match up inside a static catalog rather than under it", () => {
    const plan = planRegistryHop(resolved("urn:air:noinfra.ai:mcp:noinfra", "publisher", "https://noinfra.ai/.well-known/ai-catalog.json"));
    expect(plan).toEqual({ kind: "entry", steps: [{ url: "https://noinfra.ai/.well-known/ai-catalog.json", shape: "document" }] });
  });

  it("asks a registry API for the entry, falling back to the well-known catalog", () => {
    expect(planRegistryHop(resolved("urn:air:travel26.net:agent:flights", "publisher", "https://travel26.net/api/")).steps).toEqual([
      { url: "https://travel26.net/api/agents/flights", shape: "entry" },
      { url: "https://travel26.net/.well-known/ai-catalog.json", shape: "document" },
    ]);
  });

  it("has nothing to try for an entry without a URL", () => {
    expect(planRegistryHop(resolved("urn:air:a.com:agent:x", "exact", undefined)).steps).toEqual([]);
  });
});

describe("resolveRegistryHop", () => {
  it("returns the catalog's entries for a catalog identifier", async () => {
    const url = "https://noinfra.ai/.well-known/ai-catalog.json";
    const hop = await resolveRegistryHop(resolved("urn:air:noinfra.ai:catalog:root", "exact", url),
      fetcher({ [url]: doc("urn:air:noinfra.ai:mcp:noinfra") }));
    expect(hop.kind).toBe("catalog");
    expect(hop.kind === "catalog" && hop.document.entries.map((e) => e.identifier)).toEqual(["urn:air:noinfra.ai:mcp:noinfra"]);
  });

  it("finds an agent under a static .well-known publisher by its full URN", async () => {
    const url = "https://noinfra.ai/.well-known/ai-catalog.json";
    const hop = await resolveRegistryHop(resolved("urn:air:noinfra.ai:mcp:noinfra", "publisher", url),
      fetcher({ [url]: doc("urn:air:noinfra.ai:mcp:other", "urn:air:noinfra.ai:mcp:noinfra") }));
    expect(hop).toMatchObject({ kind: "entry", url, entry: { identifier: "urn:air:noinfra.ai:mcp:noinfra" } });
  });

  it("finds an agent listed by bare short-name in the well-known fallback when the registry has no API", async () => {
    const fetchJson = fetcher({ "https://solara.associates/.well-known/ai-catalog.json": doc("vaid-verifier") });
    const hop = await resolveRegistryHop(
      resolved("urn:air:solara.associates:agent:vaid-verifier", "publisher", "https://solara.associates"), fetchJson);
    expect(fetchJson.mock.calls.map(([u]) => u)).toEqual([
      "https://solara.associates/agents/vaid-verifier",
      "https://solara.associates/.well-known/ai-catalog.json",
    ]);
    expect(hop).toMatchObject({ kind: "entry", entry: { identifier: "vaid-verifier" } });
  });

  it("uses the registry API's entry when it answers, without the fallback", async () => {
    const fetchJson = fetcher({ "https://travel26.net/api/agents/flights": { identifier: "flights", displayName: "Flights", mediaType: CARD } });
    const hop = await resolveRegistryHop(resolved("urn:air:travel26.net:agent:flights", "publisher", "https://travel26.net/api"), fetchJson);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(hop).toMatchObject({ kind: "entry", entry: { identifier: "flights" } });
  });

  it("reports an entry missing from a catalog that answered, not a network error", async () => {
    const url = "https://a.com/ai-catalog.json";
    await expect(resolveRegistryHop(resolved("urn:air:a.com:agent:gone", "publisher", url), fetcher({ [url]: doc("other") })))
      .rejects.toBeInstanceOf(CatalogEntryNotFound);
  });

  it("rethrows the registered URL's error when nothing answers", async () => {
    await expect(resolveRegistryHop(resolved("urn:air:down.com:agent:x", "publisher", "https://down.com/api"), fetcher({})))
      .rejects.toThrow("404 https://down.com/api/agents/x");
  });
});
