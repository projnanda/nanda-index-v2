import { afterEach, expect, it, vi } from "vitest";
import { ApiError, fetchFactsUrl } from "./nanda-api";
afterEach(() => vi.unstubAllGlobals());
it("rejects invalid JSON from a successful discovery response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>upstream error</html>", { status: 200 })));
  await expect(fetchFactsUrl("https://example.org/card.json")).rejects.toBeInstanceOf(SyntaxError);
});
it("preserves an HTTP failure separately from JSON parsing", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not found", { status: 404 })));
  await expect(fetchFactsUrl("https://example.org/card.json")).rejects.toBeInstanceOf(ApiError);
});
