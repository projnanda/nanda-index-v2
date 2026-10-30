// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ResolvePage from "./page";
import type { ResolveResponse } from "@/lib/nanda-types";
const urn = "urn:air:example.org:agent:orders";
const index: ResolveResponse = { locator: urn, identifier: "orders", match: "publisher", entry: { identifier: "urn:air:example.org:catalog:main", displayName: "Catalog", type: "application/ai-catalog+json", url: "https://example.org/ai-catalog.json", tags: [], updatedAt: "2026-01-01" } };
const entry = { identifier: urn, displayName: "Orders", mediaType: "application/a2a-agent-card+json", url: "https://example.org/card.json" };
beforeEach(() => { window.history.replaceState(null, "", `/resolve?urn=${encodeURIComponent(urn)}`); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const json = (body: unknown) => new Response(JSON.stringify(body));
it("retries a card selected from a static catalog without repeating successful upstream requests", async () => {
  let cardCalls = 0;
  const fetch = vi.fn(async (url: string) => {
    if (url.startsWith("/api/v1/resolve")) return json(index);
    if (url === index.entry.url) return json({ entries: [entry] });
    if (url === entry.url) return ++cardCalls === 1 ? new Response("unavailable", { status: 503 }) : json({ name: "Orders", url: "https://example.org/run" });
    throw new Error(`Unexpected URL ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  render(<ResolvePage />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry Agent Card" }));
  await screen.findByRole("button", { name: "Send" });
  expect(fetch.mock.calls.filter(([url]) => url === index.entry.url)).toHaveLength(1);
  expect(fetch.mock.calls.filter(([url]) => url.startsWith("/api/v1/resolve"))).toHaveLength(1);
  expect(cardCalls).toBe(2);
});
it("finishes catalog-only identifiers without fetching a card or runtime", async () => {
  const fetch = vi.fn(async (url: string) => url.startsWith("/api/v1/resolve") ? json({ ...index, match: "exact" }) : json({ entries: [entry] }));
  vi.stubGlobal("fetch", fetch);
  render(<ResolvePage />);
  expect(await screen.findByText(/This identifier names a catalog of 1 entry/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("status").textContent).toContain("Index and source fetched");
});
it("retains the DNS-SVCB explanation and explicitly skips downstream hops", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ ...index, entry: { ...index.entry, url: undefined, extensions: { "org.projectnanda": { resolutionRole: "dns-svcb-pointer", domain: "example.org" } } } })));
  render(<ResolvePage />);
  expect(await screen.findByText(/dig example.org SVCB/)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("discovery stopped at hop 2");
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
});
