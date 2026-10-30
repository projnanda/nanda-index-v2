import { afterEach, expect, it, vi } from "vitest";
import { ApiError, fetchFactsUrl, fetchRegistryHop } from "./nanda-api";
afterEach(() => vi.unstubAllGlobals());
it("rejects invalid JSON from a successful discovery response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>upstream error</html>", { status: 200 })));
  await expect(fetchFactsUrl("https://example.org/card.json")).rejects.toBeInstanceOf(SyntaxError);
});
it("preserves an HTTP failure separately from JSON parsing", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not found", { status: 404 })));
  await expect(fetchFactsUrl("https://example.org/card.json")).rejects.toBeInstanceOf(ApiError);
});

it("preserves invalid-JSON diagnostics through the catalog hop fetcher", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON", { status: 200 })));
  await expect(fetchRegistryHop({ locator: "urn:air:example.org:agent:x", identifier: "x", match: "exact", entry: { identifier: "urn:air:example.org:agent:x", displayName: "X", type: "application/a2a-agent-card+json", url: "https://example.org/card", tags: [], extensions: {}, updatedAt: "2026-01-01" } })).rejects.toBeInstanceOf(SyntaxError);
});
