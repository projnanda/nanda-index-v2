// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ExplorePage from "./page";
import { listIndexRecords } from "@/lib/nanda-api";
import type { IndexCatalogEntry } from "@/lib/nanda-types";
vi.mock("@/lib/nanda-api", () => ({ listIndexRecords: vi.fn() }));
const personal = "urn:air:host39.org:personal:ada@example.org";
const rows = Array.from({ length: 12 }, (_, i) => ({ identifier: i === 10 ? personal : `urn:air:example.org:agent:${i}`, displayName: `Resource ${i}`, type: "application/mcp-server-card+json", url: "https://example.org/card", tags: [], updatedAt: "2026-01-01", extensions: { "org.projectnanda": { resolutionRole: "personal-agent-card" } } } as IndexCatalogEntry));
beforeEach(() => { vi.resetAllMocks(); window.history.replaceState(null, "", "/explore"); vi.mocked(listIndexRecords).mockResolvedValue(rows); });
afterEach(cleanup);
it("restores independent facets, page and a selected personal entry after the list arrives", async () => {
  window.history.replaceState(null, "", `/explore?owner=personal&protocol=mcp&page=2#entry=${encodeURIComponent(personal)}`);
  render(<ExplorePage />);
  expect(await screen.findByRole("dialog", { name: "Resource 10 details" })).toBeTruthy();
  expect((screen.getByRole("checkbox", { name: /Personal/ }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("checkbox", { name: /MCP/ }) as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByRole("button", { name: /Resource 0/ })).toBeNull();
  const link = screen.getByRole("link", { name: "Resolve this identifier" }) as HTMLAnchorElement;
  expect(new URL(link.href).search).toBe("");
  expect(new URLSearchParams(new URL(link.href).hash.slice(1)).get("urn")).toBe(personal);
});
it("puts changed facets in history and restores an open entry through back navigation", async () => {
  render(<ExplorePage />);
  const card = await screen.findByRole("button", { name: /Resource 0/ });
  fireEvent.click(screen.getByRole("checkbox", { name: /Personal/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /MCP/ }));
  expect(window.location.search).toContain("owner=personal");
  expect(window.location.search).toContain("protocol=mcp");
  fireEvent.click(card);
  expect(await screen.findByRole("dialog", { name: "Resource 0 details" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close details" }));
  act(() => { window.history.back(); });
  await waitFor(() => expect(screen.getByRole("dialog", { name: "Resource 0 details" })).toBeTruthy());
});
it("restores page navigation and keeps typed email searches in the fragment", async () => {
  render(<ExplorePage />);
  await screen.findByRole("button", { name: /Resource 0/ });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(window.location.search).toContain("page=2");
  expect(screen.queryByRole("button", { name: /Resource 0/ })).toBeNull();
  act(() => { window.history.back(); });
  await screen.findByRole("button", { name: /Resource 0/ });
  fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "ada@example.org" } });
  expect(new URLSearchParams(window.location.search).get("q")).toBeNull();
  expect(new URLSearchParams(window.location.hash.slice(1)).get("q")).toBe("ada@example.org");
  expect(screen.getByRole("button", { name: /Resource 10/ })).toBeTruthy();
});
it("shows a useful missing-entry state instead of silently dropping a shared selection", async () => {
  window.history.replaceState(null, "", "/explore?entry=urn%3Aair%3Aexample.org%3Aagent%3Amissing");
  render(<ExplorePage />);
  expect(await screen.findByRole("status")).toHaveProperty("textContent", "This shared entry is not available in the index.");
});
