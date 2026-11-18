// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ResolvePage from "./page";
import { ApiError, fetchFactsUrl, fetchRegistryHop, resolveAgent } from "@/lib/nanda-api";
import { PERSONAL_DATA_CLASS, REPLAY_MASK_CLASS } from "@/lib/analyticsPrivacy";
import type { CatalogEntry } from "@/lib/nanda-types";

vi.mock("@/lib/nanda-api", async () => {
  const original = await vi.importActual<typeof import("@/lib/nanda-api")>("@/lib/nanda-api");
  return { ...original, resolveAgent: vi.fn(), fetchRegistryHop: vi.fn(), fetchFactsUrl: vi.fn() };
});
const identifier = "urn:air:example.org:agent:demo";
const entryHop = (entry: unknown) => ({ kind: "entry" as const, url: "https://example.org/agents/demo", entry: entry as CatalogEntry });
const index = { locator: identifier, publisher: "example.org", namespace: ["agent"], identifier: "demo", match: "publisher" as const, entry: { identifier, displayName: "Example", type: "application/ai-catalog+json", url: "https://example.org", tags: [], updatedAt: "2026-01-01", extensions: {} } };
beforeEach(() => { window.history.replaceState(null, "", "/resolve"); vi.resetAllMocks(); vi.mocked(resolveAgent).mockResolvedValue(index); vi.mocked(fetchRegistryHop).mockResolvedValue(entryHop({ identifier, displayName: "Example", mediaType: "application/a2a-agent-card+json", url: "https://example.org/card.json" })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function submit() {
  render(<ResolvePage />);
  fireEvent.change(screen.getByRole("textbox", { name: "Resource identifier" }), { target: { value: identifier } });
  fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
}
it("retries a failed card hop without repeating successful earlier requests", async () => {
  vi.mocked(fetchFactsUrl).mockRejectedValueOnce(new SyntaxError("invalid")).mockResolvedValueOnce({ name: "Example" });
  await submit();
  fireEvent.click(await screen.findByRole("button", { name: "Retry Agent Card" }));
  await waitFor(() => expect(fetchFactsUrl).toHaveBeenCalledTimes(2));
  expect(resolveAgent).toHaveBeenCalledTimes(1);
  expect(fetchRegistryHop).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/Index, source and card fetched/)).toBeTruthy();
});
it("retries the source and remaining hops while preserving the index response", async () => {
  vi.mocked(fetchRegistryHop).mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(entryHop({ identifier, displayName: "Example", mediaType: "application/a2a-agent-card+json", url: "https://example.org/card.json" }));
  vi.mocked(fetchFactsUrl).mockResolvedValue({ name: "Example" });
  await submit();
  fireEvent.click(await screen.findByRole("button", { name: "Retry Agent Source" }));
  await waitFor(() => expect(fetchFactsUrl).toHaveBeenCalledTimes(1));
  expect(resolveAgent).toHaveBeenCalledTimes(1);
  expect(fetchRegistryHop).toHaveBeenCalledTimes(2);
});
it("explains browser uncertainty and prefills a broken entry report", async () => {
  vi.mocked(fetchRegistryHop).mockRejectedValue(new TypeError("fetch failed"));
  await submit();
  expect(await screen.findByText(/Network, TLS, and cross-origin failures/)).toBeTruthy();
  const link = screen.getByRole("link", { name: "Report broken entry" }) as HTMLAnchorElement;
  expect(new URL(link.href).searchParams.get("body")).toContain(identifier);
});
it("retries the index for the original identifier even after editing the input", async () => {
  vi.mocked(resolveAgent).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(index);
  vi.mocked(fetchFactsUrl).mockResolvedValue({ name: "Example" });
  await submit();
  const retry = await screen.findByRole("button", { name: "Retry NANDA Index" });
  fireEvent.change(screen.getByRole("textbox", { name: "Resource identifier" }), { target: { value: "urn:air:other.org:agent:x" } });
  fireEvent.click(retry);
  await screen.findByText(/Index, source and card fetched/);
  expect(resolveAgent).toHaveBeenNthCalledWith(2, identifier);
});
it("keeps a non-JSON HTTP runtime error classified by its HTTP status", async () => {
  vi.mocked(fetchFactsUrl).mockResolvedValue({ url: "https://example.org/runtime" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("maintenance", { status: 503 })));
  await submit();
  fireEvent.click(await screen.findByRole("button", { name: "Send" }));
  expect(await screen.findByText(/HTTP 503/)).toBeTruthy();
  vi.unstubAllGlobals();
});
it("reports malformed source data and offers a retry instead of leaving the trace stuck", async () => {
  vi.mocked(fetchRegistryHop).mockResolvedValue(entryHop(null));
  await submit();
  expect(await screen.findByText(/source response must be a JSON object/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retry Agent Source" }).hasAttribute("disabled")).toBe(false);
});
it.each(["catalog", "smb", "personal"] as const)("runs the controlled %s preset through the card without using the public index", async (kind) => {
  const { exampleResponse, resolveExamples } = await import("@/lib/resolveExamples");
  const preset = resolveExamples.find((example) => example.kind === kind)!;
  vi.mocked(fetchFactsUrl).mockImplementation(async (url) => exampleResponse(kind, [url.endsWith("/index") ? "index" : "card"]));
  vi.mocked(fetchRegistryHop).mockResolvedValue(entryHop(exampleResponse(kind, kind === "catalog" ? ["registry", "agents", "demo"] : ["card"])));
  render(<ResolvePage />);
  fireEvent.click(screen.getByRole("button", { name: preset.label }));
  expect(await screen.findByRole("button", { name: "Send" })).toBeTruthy();
  expect(resolveAgent).not.toHaveBeenCalled();
  expect(fetchFactsUrl).toHaveBeenCalledTimes(kind === "catalog" ? 2 : 1);
  expect(screen.getByRole("note").textContent).toContain("sample index");
});
it("lists a catalog named by an exact identifier and stops before the card hop", async () => {
  const entries = [{ identifier: "urn:air:example.org:agent:a", displayName: "A" }];
  vi.mocked(fetchRegistryHop).mockResolvedValue({ kind: "catalog", url: "https://example.org/agents", document: { specVersion: "1.0", entries } as never });
  await submit();
  expect(await screen.findByText(/names a catalog of 1 entry/)).toBeTruthy();
  expect(fetchFactsUrl).not.toHaveBeenCalled();
});
it("hides the typed identifier from session replays wherever the trace shows it back", async () => {
  const typed = "urn:air:host39.org:personal:ada@example.org";
  vi.mocked(resolveAgent).mockRejectedValue(new ApiError(`invalid identifier "${typed}"`, 400));
  render(<ResolvePage />);
  fireEvent.change(screen.getByRole("textbox", { name: "Resource identifier" }), { target: { value: typed } });
  fireEvent.click(screen.getByRole("button", { name: "Resolve" }));

  const error = await screen.findByText(`HTTP 400: invalid identifier "${typed}"`);
  const requestUrl = screen.getByText(/\/api\/v1\/resolve\?locator=/);
  for (const element of [error, requestUrl]) {
    expect(element.className.split(" ")).toEqual(expect.arrayContaining(PERSONAL_DATA_CLASS.split(" ")));
  }
  // The hop's own label is site copy and stays readable.
  expect(screen.getByText("NANDA Index").closest(`.${REPLAY_MASK_CLASS}`)).toBeNull();
});

// ── Shareable trace ─────────────────────────────────────────────────────────

const personalUrn = "urn:air:host39.org:personal:ada@example.org";
const urlQuery = () => new URLSearchParams(window.location.search);
const urlFragment = () => new URLSearchParams(window.location.hash.slice(1));
const identifierBox = () => screen.getByRole("textbox", { name: "Resource identifier" }) as HTMLInputElement;

async function presetFixtures(kind: "catalog" | "smb" | "personal") {
  const { exampleResponse, resolveExamples } = await import("@/lib/resolveExamples");
  vi.mocked(fetchFactsUrl).mockImplementation(async (url) => exampleResponse(kind, [url.endsWith("/index") ? "index" : "card"]));
  vi.mocked(fetchRegistryHop).mockResolvedValue(entryHop(exampleResponse(kind, ["card"])));
  return resolveExamples.find((example) => example.kind === kind)!;
}

it("puts a submitted identifier in the address and runs it once", async () => {
  vi.mocked(fetchFactsUrl).mockResolvedValue({ name: "Example" });
  await submit();
  await screen.findByText(/Index, source and card fetched/);
  expect(urlQuery().get("urn")).toBe(identifier);
  expect(urlQuery().get("example")).toBeNull();
  expect(resolveAgent).toHaveBeenCalledTimes(1);
});

it("runs the discovery hops for the identifier a shared link carries, and waits for Send before the runtime", async () => {
  vi.mocked(fetchFactsUrl).mockResolvedValue({ url: "https://example.org/runtime" });
  const runtime = vi.fn();
  vi.stubGlobal("fetch", runtime);
  window.history.replaceState(null, "", `/resolve?urn=${encodeURIComponent(identifier)}`);
  render(<ResolvePage />);
  expect(await screen.findByRole("button", { name: "Send" })).toBeTruthy();
  expect(identifierBox().value).toBe(identifier);
  expect(resolveAgent).toHaveBeenCalledWith(identifier);
  expect(runtime).not.toHaveBeenCalled();
});

it("runs nothing when the link carries no identifier", async () => {
  render(<ResolvePage />);
  await act(async () => {});
  expect(screen.getByText("Enter a URN above to trace the resolution hops.")).toBeTruthy();
  expect(resolveAgent).not.toHaveBeenCalled();
});

it("keeps a personal identifier in the fragment and explains what that means", async () => {
  vi.mocked(resolveAgent).mockRejectedValue(new ApiError("not found", 404));
  render(<ResolvePage />);
  fireEvent.change(identifierBox(), { target: { value: personalUrn } });
  fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
  await waitFor(() => expect(resolveAgent).toHaveBeenCalledWith(personalUrn));
  expect(window.location.search).toBe("");
  expect(urlFragment().get("urn")).toBe(personalUrn);
  expect(await screen.findByText(/remain in browser history and shared links/)).toBeTruthy();
});

it("discards a pending trace when the visitor goes back", async () => {
  let answerIndex!: (value: typeof index) => void;
  vi.mocked(resolveAgent).mockImplementationOnce(() => new Promise((resolve) => { answerIndex = resolve; }));
  window.history.pushState(null, "", `/resolve#urn=${encodeURIComponent(personalUrn)}`);
  render(<ResolvePage />);
  await waitFor(() => expect(resolveAgent).toHaveBeenCalledWith(personalUrn));
  act(() => window.history.back());
  await screen.findByText("Enter a URN above to trace the resolution hops.");
  await act(async () => answerIndex(index));
  expect(fetchRegistryHop).not.toHaveBeenCalled();
});

it("restores the earlier trace when the visitor goes back from a second one", async () => {
  const second = "urn:air:other.org:agent:x";
  vi.mocked(fetchFactsUrl).mockResolvedValue({ name: "Example" });
  await submit();
  await screen.findByText(/Index, source and card fetched/);
  fireEvent.change(identifierBox(), { target: { value: second } });
  fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
  await waitFor(() => expect(resolveAgent).toHaveBeenLastCalledWith(second));
  act(() => window.history.back());
  await waitFor(() => expect(identifierBox().value).toBe(identifier));
  await waitFor(() => expect(resolveAgent).toHaveBeenLastCalledWith(identifier));
});

it("records a demonstration in the address and restores it from a link without the public index or the runtime", async () => {
  const preset = await presetFixtures("personal");
  const runtime = vi.fn();
  vi.stubGlobal("fetch", runtime);
  window.history.replaceState(null, "", `/resolve?example=personal#urn=${encodeURIComponent(preset.identifier)}`);
  render(<ResolvePage />);
  await screen.findByRole("button", { name: "Send" });
  expect(screen.getByRole("note").textContent).toContain("sample index");
  expect(resolveAgent).not.toHaveBeenCalled();
  expect(runtime).not.toHaveBeenCalled();
});

it("writes the demonstration a visitor picks into the address", async () => {
  const preset = await presetFixtures("smb");
  render(<ResolvePage />);
  fireEvent.click(screen.getByRole("button", { name: preset.label }));
  await screen.findByRole("button", { name: "Send" });
  expect(urlQuery().get("example")).toBe("smb");
  expect(readUrn()).toBe(preset.identifier);
});

it("keeps a shared demonstration on the sample index when it is submitted again", async () => {
  const preset = await presetFixtures("smb");
  window.history.replaceState(null, "", `/resolve?example=smb&urn=${encodeURIComponent(preset.identifier)}`);
  render(<ResolvePage />);
  await screen.findByRole("button", { name: "Send" });
  const before = vi.mocked(fetchFactsUrl).mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
  await waitFor(() => expect(vi.mocked(fetchFactsUrl).mock.calls.length).toBeGreaterThan(before));
  expect(resolveAgent).not.toHaveBeenCalled();
});

// A link must not be able to dress a real identifier up as a demonstration,
// or route a demonstration's identifier through another fixture.
it("resolves through the public index when a link pairs example with an identifier that is not that fixture's", async () => {
  vi.mocked(fetchFactsUrl).mockResolvedValue({ name: "Example" });
  window.history.replaceState(null, "", `/resolve?example=smb&urn=${encodeURIComponent(identifier)}`);
  render(<ResolvePage />);
  await screen.findByText(/Index, source and card fetched/);
  expect(resolveAgent).toHaveBeenCalledWith(identifier);
  expect(screen.queryByRole("note")).toBeNull();
});

function readUrn() {
  return urlFragment().get("urn") ?? urlQuery().get("urn");
}
