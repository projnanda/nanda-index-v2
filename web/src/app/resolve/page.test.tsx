// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ResolvePage from "./page";
import { fetchAgentRecord, fetchFactsUrl, resolveAgent } from "@/lib/nanda-api";

vi.mock("@/lib/nanda-api", async () => {
  const original = await vi.importActual<typeof import("@/lib/nanda-api")>("@/lib/nanda-api");
  return { ...original, resolveAgent: vi.fn(), fetchAgentRecord: vi.fn(), fetchFactsUrl: vi.fn() };
});
const identifier = "urn:air:example.org:agent:demo";
const index = { locator: identifier, publisher: "example.org", namespace: ["agent"], identifier: "demo", match: "publisher" as const, entry: { identifier, displayName: "Example", type: "application/ai-catalog+json", url: "https://example.org", tags: [], updatedAt: "2026-01-01", extensions: {} } };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(resolveAgent).mockResolvedValue(index); vi.mocked(fetchAgentRecord).mockResolvedValue({ identifier, displayName: "Example", mediaType: "application/a2a-agent-card+json", url: "https://example.org/card.json" }); });
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
  expect(fetchAgentRecord).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/Index, source and card fetched/)).toBeTruthy();
});
it("retries the source and remaining hops while preserving the index response", async () => {
  vi.mocked(fetchAgentRecord).mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce({ identifier, displayName: "Example", mediaType: "application/a2a-agent-card+json", url: "https://example.org/card.json" });
  vi.mocked(fetchFactsUrl).mockResolvedValue({ name: "Example" });
  await submit();
  fireEvent.click(await screen.findByRole("button", { name: "Retry Agent Source" }));
  await waitFor(() => expect(fetchFactsUrl).toHaveBeenCalledTimes(1));
  expect(resolveAgent).toHaveBeenCalledTimes(1);
  expect(fetchAgentRecord).toHaveBeenCalledTimes(2);
});
it("explains browser uncertainty and prefills a broken entry report", async () => {
  vi.mocked(fetchAgentRecord).mockRejectedValue(new TypeError("fetch failed"));
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
  vi.mocked(fetchAgentRecord).mockResolvedValue(null as never);
  await submit();
  expect(await screen.findByText(/source response must be a JSON object/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retry Agent Source" }).hasAttribute("disabled")).toBe(false);
});
it.each(["catalog", "smb", "personal"] as const)("runs the controlled %s preset through the card without using the public index", async (kind) => {
  const { exampleResponse, resolveExamples } = await import("@/lib/resolveExamples");
  const preset = resolveExamples.find((example) => example.kind === kind)!;
  vi.mocked(fetchFactsUrl).mockImplementation(async (url) => exampleResponse(kind, [url.endsWith("/index") ? "index" : "card"], "https://index.example"));
  vi.mocked(fetchAgentRecord).mockResolvedValue(exampleResponse(kind, kind === "catalog" ? ["registry", "agents", "demo"] : ["card"], "https://index.example") as Awaited<ReturnType<typeof fetchAgentRecord>>);
  render(<ResolvePage />);
  fireEvent.click(screen.getByRole("button", { name: preset.label }));
  expect(await screen.findByRole("button", { name: "Send" })).toBeTruthy();
  expect(resolveAgent).not.toHaveBeenCalled();
  expect(fetchFactsUrl).toHaveBeenCalledTimes(kind === "catalog" ? 2 : 1);
  expect(screen.getByRole("note").textContent).toContain("sample index");
});
