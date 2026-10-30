// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { discoveryLink, navigateDiscovery, pageNumber, readDiscoveryState, selectedValues, useDiscoveryLocation } from "./discoveryLocation";
const personal = "urn:air:host39.org:personal:ada@example.org";
beforeEach(() => { window.history.replaceState(null, "", "/explore"); });
afterEach(cleanup);
it("round trips text, independent facets, page and selected entry", () => {
  const state = { q: "cake & tea", owner: "personal,smb", protocol: "mcp", page: "2", entry: "urn:air:example.org:agent:tea" };
  expect(readDiscoveryState(discoveryLink("/explore", state))).toEqual(state);
  expect([...selectedValues("personal,unknown,personal", { personal: "Personal", smb: "SMB" })]).toEqual(["personal"]);
  for (const value of ["-1", "NaN", "0", "1.2", "Infinity"]) expect(pageNumber(value)).toBe(1);
});
it("keeps email searches and personal identifiers out of query strings", () => {
  const url = new URL(discoveryLink("/explore", { q: "Ada@Example.org", entry: personal, protocol: "mcp" }), "https://example.org");
  expect(url.searchParams.get("q")).toBeNull();
  expect(url.searchParams.get("entry")).toBeNull();
  expect(url.searchParams.get("protocol")).toBe("mcp");
  expect(readDiscoveryState(url.href).entry).toBe(personal);
  expect(new URL(discoveryLink("/resolve", { urn: personal }), url).search).toBe("");
});
it("updates subscribers and restores state with browser back and forward", async () => {
  const { result } = renderHook(useDiscoveryLocation);
  act(() => { navigateDiscovery({ q: "one", owner: "personal" }); });
  act(() => { navigateDiscovery({ q: "two", protocol: "mcp" }); });
  expect(result.current.state.q).toBe("two");
  act(() => { window.history.back(); });
  await waitFor(() => expect(result.current.state.q).toBe("one"));
  expect(result.current.state.protocol).toBeUndefined();
  act(() => { window.history.forward(); });
  await waitFor(() => expect(result.current.state.protocol).toBe("mcp"));
});
it("moves incoming email query values into the fragment without losing their state", async () => {
  window.history.replaceState(null, "", `/resolve?urn=${encodeURIComponent(personal)}`);
  const { result } = renderHook(useDiscoveryLocation);
  await waitFor(() => expect(window.location.search).toBe(""));
  expect(result.current.state.urn).toBe(personal);
});
