// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import QueryPage from "./page";
import { agenticSearch, getIndexRecord, resolveAgent, searchIndexRecords } from "@/lib/nanda-api";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/nanda-api", async () => {
  const original = await vi.importActual<typeof import("@/lib/nanda-api")>("@/lib/nanda-api");
  return { ...original, searchIndexRecords: vi.fn(), getIndexRecord: vi.fn(), resolveAgent: vi.fn(), fetchRegistryHop: vi.fn(), agenticSearch: vi.fn() };
});
beforeEach(() => { vi.resetAllMocks(); window.history.replaceState(null, "", "/discover"); vi.mocked(searchIndexRecords).mockResolvedValue({ query: "cake", count: 0, results: [] }); });
afterEach(cleanup);
it("runs a shared keyword query and ignores a slower result after history navigation", async () => {
  let first!: (value: Awaited<ReturnType<typeof searchIndexRecords>>) => void;
  vi.mocked(searchIndexRecords).mockImplementationOnce(() => new Promise((resolve) => { first = resolve; })).mockResolvedValueOnce({ query: "new", count: 0, results: [] });
  window.history.replaceState(null, "", "/discover?q=old");
  render(<QueryPage />);
  await waitFor(() => expect(searchIndexRecords).toHaveBeenCalledWith("old"));
  act(() => { window.history.pushState(null, "", "/discover?q=new"); window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(await screen.findByText('No active organizations match "new".')).toBeTruthy();
  await act(async () => { first({ query: "old", count: 0, results: [] }); });
  expect(screen.queryByText('No active organizations match "old".')).toBeNull();
});
it("commits a submitted query and its chosen mode to the shareable URL", async () => {
  vi.mocked(getIndexRecord).mockRejectedValue(new Error("test failure"));
  render(<QueryPage />);
  fireEvent.click(screen.getByRole("button", { name: "By Org ID" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Discovery query" }), { target: { value: "my-org" } });
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  await waitFor(() => expect(getIndexRecord).toHaveBeenCalledWith("my-org"));
  expect(new URLSearchParams(window.location.search).get("mode")).toBe("org_id");
  expect(new URLSearchParams(window.location.search).get("q")).toBe("my-org");
});
it("restores a private locator from the fragment without putting it in the page query", async () => {
  const urn = "urn:air:host39.org:personal:ada@example.org";
  vi.mocked(resolveAgent).mockRejectedValue(new Error("test failure"));
  window.history.replaceState(null, "", `/discover#locator=${encodeURIComponent(urn)}`);
  render(<QueryPage />);
  await waitFor(() => expect(resolveAgent).toHaveBeenCalledWith(urn));
  expect(window.location.search).toBe("");
  expect(await screen.findByText(/remain in browser history and shared links/)).toBeTruthy();
});
it("can rerun the same shared query when the URL omitted its default mode", async () => {
  window.history.replaceState(null, "", "/discover?q=cake");
  render(<QueryPage />);
  await screen.findByText('No active organizations match "cake".');
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  await waitFor(() => expect(searchIndexRecords).toHaveBeenCalledTimes(2));
});

it("does not restore hidden agentic mode from a shared URL", async () => {
  window.history.replaceState(null, "", "/discover?q=cake&mode=agentic");
  render(<QueryPage />);
  await screen.findByText('No active organizations match "cake".');
  expect(agenticSearch).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Agentic Search" })).toBeNull();
});
