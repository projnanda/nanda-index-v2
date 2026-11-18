// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import QueryPage from "./page";
import { ApiError, agenticSearch, fetchRegistryHop, getIndexRecord, resolveAgent, searchIndexRecords } from "@/lib/nanda-api";
import { PERSONAL_DATA_CLASS, REPLAY_MASK_CLASS } from "@/lib/analyticsPrivacy";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/nanda-api", async () => {
  const original = await vi.importActual<typeof import("@/lib/nanda-api")>("@/lib/nanda-api");
  return { ...original, searchIndexRecords: vi.fn(), getIndexRecord: vi.fn(), resolveAgent: vi.fn(), fetchRegistryHop: vi.fn(), agenticSearch: vi.fn() };
});

const typed = "ada@example.org weather";

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/query");
});
afterEach(cleanup);

function run(query: string) {
  render(<QueryPage />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: query } });
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
}

function isPersonal(element: Element | null) {
  expect(element?.className.split(" ")).toEqual(expect.arrayContaining(PERSONAL_DATA_CLASS.split(" ")));
}

it("hides a search term from session replays where the results repeat it", async () => {
  vi.mocked(searchIndexRecords).mockResolvedValue({ query: typed, count: 0, results: [] });
  run(typed);

  const echoes = await screen.findAllByText(typed, { selector: "span" });
  expect(echoes.length).toBeGreaterThan(0);
  echoes.forEach(isPersonal);
  isPersonal(screen.getByText(/"query":/, { selector: "pre" }));
  // The surrounding copy stays readable.
  expect(screen.getByText("No organizations found").closest(`.${REPLAY_MASK_CLASS}`)).toBeNull();
});

it("hides an error that quotes the typed org ID", async () => {
  vi.mocked(getIndexRecord).mockRejectedValue(new ApiError('org "ada-private" not found', 404));
  render(<QueryPage />);
  fireEvent.click(screen.getByRole("button", { name: "By Org ID" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "ada-private" } });
  fireEvent.click(screen.getByRole("button", { name: "Run" }));

  isPersonal(await screen.findByText('404: org "ada-private" not found'));
});

// ── Shareable query ─────────────────────────────────────────────────────────

const noResults = (query: string) => ({ query, count: 0, results: [] });
const urlQuery = () => new URLSearchParams(window.location.search);
const urlFragment = () => new URLSearchParams(window.location.hash.slice(1));
const queryBox = () => screen.getByRole("textbox", { name: "Discovery query" }) as HTMLInputElement;

function open(address: string) {
  window.history.replaceState(null, "", address);
  render(<QueryPage />);
}

it("runs the query a shared link carries and shows it in the form", async () => {
  vi.mocked(searchIndexRecords).mockResolvedValue(noResults("cake"));
  open("/query?q=cake");
  expect(await screen.findByText("No organizations found")).toBeTruthy();
  expect(searchIndexRecords).toHaveBeenCalledWith("cake");
  expect(queryBox().value).toBe("cake");
});

it("runs nothing when the link carries no query", async () => {
  open("/query?mode=org_id");
  expect(screen.getByText("No query yet")).toBeTruthy();
  await act(async () => {});
  expect(getIndexRecord).not.toHaveBeenCalled();
  expect(searchIndexRecords).not.toHaveBeenCalled();
});

it("restores the mode a link asks for", async () => {
  vi.mocked(getIndexRecord).mockRejectedValue(new ApiError("not found", 404));
  open("/query?q=my-org&mode=org_id");
  await waitFor(() => expect(getIndexRecord).toHaveBeenCalledWith("my-org"));
  expect(searchIndexRecords).not.toHaveBeenCalled();
});

// Agentic search is hidden from the page, so a link must not be able to run it.
it("runs a keyword search, never the hidden agentic search, for a link that asks for agentic mode", async () => {
  vi.mocked(searchIndexRecords).mockResolvedValue(noResults("order a cake"));
  open("/query?q=order+a+cake&mode=agentic");
  await waitFor(() => expect(searchIndexRecords).toHaveBeenCalledWith("order a cake"));
  expect(agenticSearch).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Agentic Search" })).toBeNull();
});

it("ignores a mode the page does not know", async () => {
  vi.mocked(searchIndexRecords).mockResolvedValue(noResults("cake"));
  open("/query?q=cake&mode=__proto__");
  await waitFor(() => expect(searchIndexRecords).toHaveBeenCalledWith("cake"));
});

it("puts a submitted query and its mode in the address", async () => {
  vi.mocked(getIndexRecord).mockRejectedValue(new ApiError("not found", 404));
  render(<QueryPage />);
  fireEvent.click(screen.getByRole("button", { name: "By Org ID" }));
  fireEvent.change(queryBox(), { target: { value: "my-org" } });
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  await waitFor(() => expect(getIndexRecord).toHaveBeenCalledWith("my-org"));
  expect(urlQuery().get("q")).toBe("my-org");
  expect(urlQuery().get("mode")).toBe("org_id");
});

it("leaves the default mode out of the address", async () => {
  vi.mocked(searchIndexRecords).mockResolvedValue(noResults("cake"));
  run("cake");
  await screen.findByText("No organizations found");
  expect(window.location.search).toBe("?q=cake");
  expect(searchIndexRecords).toHaveBeenCalledTimes(1);
});

it("keeps a typed email search out of the query string and explains what that means", async () => {
  vi.mocked(searchIndexRecords).mockResolvedValue(noResults(typed));
  run(typed);
  await screen.findByText("No organizations found");
  expect(window.location.search).toBe("");
  expect(urlFragment().get("q")).toBe(typed);
  expect(screen.getByText(/remain in browser history and shared links/)).toBeTruthy();
});

it("follows a URN through the index and the registry, as a locator in the address", async () => {
  const urn = "urn:air:example.org:agent:demo";
  const entry = { identifier: urn, displayName: "Example", type: "application/ai-catalog+json", url: "https://example.org", tags: [], updatedAt: "2026-01-01", extensions: {} };
  vi.mocked(resolveAgent).mockResolvedValue({ locator: urn, identifier: "demo", match: "publisher", entry });
  vi.mocked(fetchRegistryHop).mockResolvedValue({ kind: "catalog", url: "https://example.org", document: { specVersion: "1.0", entries: [{ identifier: "urn:air:example.org:agent:a", displayName: "A" }] } as never });
  run(urn);
  expect(await screen.findByText(/names a catalog of 1 entry/)).toBeTruthy();
  expect(urlQuery().get("locator")).toBe(urn);
  expect(urlQuery().get("q")).toBeNull();
  expect(searchIndexRecords).not.toHaveBeenCalled();
});

it("restores a personal locator from the fragment without putting it in the page query", async () => {
  const urn = "urn:air:host39.org:personal:ada@example.org";
  vi.mocked(resolveAgent).mockRejectedValue(new ApiError("not found", 404));
  open(`/query#locator=${encodeURIComponent(urn)}`);
  await waitFor(() => expect(resolveAgent).toHaveBeenCalledWith(urn));
  expect(window.location.search).toBe("");
  expect(await screen.findByText(/remain in browser history and shared links/)).toBeTruthy();
});

it("shows only the newest query when an older one answers late", async () => {
  let answerOld!: (value: ReturnType<typeof noResults>) => void;
  vi.mocked(searchIndexRecords)
    .mockImplementationOnce(() => new Promise((resolve) => { answerOld = resolve; }))
    .mockResolvedValueOnce({ query: "new", count: 1, results: [] });
  open("/query?q=old");
  await waitFor(() => expect(searchIndexRecords).toHaveBeenCalledWith("old"));
  act(() => {
    window.history.pushState(null, "", "/query?q=new");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(await screen.findByText(/1 result for/)).toBeTruthy();
  await act(async () => answerOld(noResults("old")));
  expect(screen.queryByText("No results")).toBeNull();
  expect(queryBox().value).toBe("new");
});

it("stops before the registry when the visitor has moved on from a URN query", async () => {
  const urn = "urn:air:example.org:agent:demo";
  let answerIndex!: (value: never) => void;
  vi.mocked(resolveAgent).mockImplementationOnce(() => new Promise((resolve) => { answerIndex = resolve; }));
  open(`/query?locator=${encodeURIComponent(urn)}`);
  await waitFor(() => expect(resolveAgent).toHaveBeenCalledWith(urn));
  act(() => {
    window.history.pushState(null, "", "/query");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await act(async () => answerIndex({ entry: { url: "https://example.org" } } as never));
  expect(fetchRegistryHop).not.toHaveBeenCalled();
  expect(screen.getByText("No query yet")).toBeTruthy();
});

it("runs the same query again when it is submitted a second time", async () => {
  vi.mocked(searchIndexRecords).mockResolvedValue(noResults("cake"));
  open("/query?q=cake");
  await screen.findByText("No organizations found");
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  await waitFor(() => expect(searchIndexRecords).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("No organizations found")).toBeTruthy();
});
