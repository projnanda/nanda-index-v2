// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discoveryLink,
  isPersonalValue,
  navigateDiscovery,
  pageNumber,
  readDiscoveryState,
  selectedValues,
  selectionParam,
  useDiscoveryLocation,
} from "./discoveryLocation";

const personal = "urn:air:host39.org:personal:ada@example.org";
const fragmentOf = (link: string) => new URLSearchParams(new URL(link, "https://example.org").hash.slice(1));
const queryOf = (link: string) => new URL(link, "https://example.org").searchParams;

beforeEach(() => window.history.replaceState(null, "", "/explore"));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("isPersonalValue", () => {
  it.each([
    ["ada@example.org", true],
    ["Ada%40Example.org", true],
    ["urn:air:host39.org:personal:ada", true],
    ["URN:AIR:host39.org:PERSONAL:ada", true],
    ["urn:air:example.org:agent:orders", false],
    ["cake & tea", false],
    ["", false],
  ])("judges %s as personal: %s", (value, expected) => {
    expect(isPersonalValue(value)).toBe(expected);
  });

  it("judges a malformed escape by its literal text instead of throwing", () => {
    expect(isPersonalValue("100%")).toBe(false);
    expect(isPersonalValue("%E0%A4%A@x")).toBe(true);
  });
});

describe("discoveryLink and readDiscoveryState", () => {
  it("round trips text, facets, page and selected entry", () => {
    const state = { q: "cake & tea", owner: "personal,smb", protocol: "mcp", page: "2", entry: "urn:air:example.org:agent:tea" };
    expect(readDiscoveryState(discoveryLink("/explore", state))).toEqual(state);
  });

  it("keeps email searches and personal identifiers out of the query string", () => {
    const link = discoveryLink("/explore", { q: "Ada@Example.org", entry: personal, protocol: "mcp" });
    expect(queryOf(link).get("q")).toBeNull();
    expect(queryOf(link).get("entry")).toBeNull();
    expect(queryOf(link).get("protocol")).toBe("mcp");
    expect(fragmentOf(link).get("q")).toBe("Ada@Example.org");
    expect(readDiscoveryState(link).entry).toBe(personal);
    expect(discoveryLink("/resolve", { urn: personal }).includes("?")).toBe(false);
  });

  it("omits empty values and returns the bare path for an empty view", () => {
    expect(discoveryLink("/explore", { q: "", page: "" })).toBe("/explore");
  });

  it("prefers a fragment value to the same key in the query", () => {
    expect(readDiscoveryState("/resolve?urn=old#urn=new").urn).toBe("new");
  });

  it("ignores parameters that are not part of the view", () => {
    expect(readDiscoveryState("/explore?utm_source=news&__proto__=x&q=cake")).toEqual({ q: "cake" });
  });

  it("carries unrelated query parameters, and lets the view replace its own", () => {
    const link = discoveryLink("/explore", { q: "tea" }, new URLSearchParams("utm_source=news&q=cake&page=3"));
    expect(queryOf(link).get("utm_source")).toBe("news");
    expect(queryOf(link).get("q")).toBe("tea");
    expect(queryOf(link).get("page")).toBeNull();
  });
});

describe("selectedValues, selectionParam and pageNumber", () => {
  const labels = { personal: "Personal", smb: "SMB" };

  it("keeps only known options and drops duplicates", () => {
    expect([...selectedValues("personal,unknown,personal", labels)]).toEqual(["personal"]);
    expect(selectedValues(undefined, labels).size).toBe(0);
    expect(selectedValues("toString,__proto__", labels).size).toBe(0);
  });

  it("serialises a selection in a stable order", () => {
    expect(selectionParam(new Set(["smb", "personal"]))).toBe("personal,smb");
    expect(selectionParam(new Set())).toBe("");
  });

  it.each(["-1", "NaN", "0", "1.2", "Infinity", "1e309", "", undefined])("falls back to page 1 for %s", (value) => {
    expect(pageNumber(value)).toBe(1);
  });

  it("accepts a positive integer page", () => {
    expect(pageNumber("7")).toBe(7);
  });
});

describe("navigateDiscovery", () => {
  it("merges a patch into the current view, and removes a key given an empty string", () => {
    window.history.replaceState(null, "", "/explore?q=cake&page=3");
    expect(navigateDiscovery({ owner: "personal", page: "" })).toBe(true);
    expect(readDiscoveryState(window.location.href)).toEqual({ q: "cake", owner: "personal" });
  });

  it("adds a history entry by default and reuses the current one when replacing", () => {
    const before = window.history.length;
    navigateDiscovery({ q: "one" });
    expect(window.history.length).toBe(before + 1);
    navigateDiscovery({ q: "two" }, true);
    expect(window.history.length).toBe(before + 1);
    expect(readDiscoveryState(window.location.href).q).toBe("two");
  });

  it("does nothing when the view is already in the address bar", () => {
    window.history.replaceState(null, "", "/explore?q=cake");
    const push = vi.spyOn(window.history, "pushState");
    expect(navigateDiscovery({ q: "cake" })).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps unrelated query parameters when the view changes", () => {
    window.history.replaceState(null, "", "/explore?utm_source=news");
    navigateDiscovery({ owner: "smb" });
    expect(window.location.search).toContain("utm_source=news");
    expect(window.location.search).toContain("owner=smb");
  });

  it("reports failure instead of throwing when the browser refuses a history change", () => {
    vi.spyOn(window.history, "pushState").mockImplementation(() => {
      throw new DOMException("too many calls", "SecurityError");
    });
    const notified = vi.fn();
    window.addEventListener("nanda:discovery-location", notified);
    expect(navigateDiscovery({ q: "cake" })).toBe(false);
    expect(notified).not.toHaveBeenCalled();
    window.removeEventListener("nanda:discovery-location", notified);
  });
});

describe("useDiscoveryLocation", () => {
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

  it("moves an incoming personal query value into the fragment without losing it or adding history", async () => {
    window.history.replaceState(null, "", `/resolve?urn=${encodeURIComponent(personal)}&example=personal`);
    const before = window.history.length;
    const { result } = renderHook(useDiscoveryLocation);
    await waitFor(() => expect(window.location.search).toBe("?example=personal"));
    expect(result.current.state.urn).toBe(personal);
    expect(fragmentOf(window.location.href).get("urn")).toBe(personal);
    expect(window.history.length).toBe(before);
  });

  // A framework link back to the open page changes the address silently; only
  // the Navigation API reports it.
  it("follows an address change that is reported only by the Navigation API", async () => {
    const navigation = new EventTarget();
    Object.defineProperty(window, "navigation", { value: navigation, configurable: true });
    try {
      window.history.replaceState(null, "", "/explore?protocol=mcp");
      const { result, unmount } = renderHook(useDiscoveryLocation);
      expect(result.current.state.protocol).toBe("mcp");
      window.history.pushState(null, "", "/explore");
      expect(result.current.state.protocol).toBe("mcp");
      await act(async () => { navigation.dispatchEvent(new Event("currententrychange")); });
      expect(result.current.state.protocol).toBeUndefined();
      const remove = vi.spyOn(navigation, "removeEventListener");
      unmount();
      expect(remove).toHaveBeenCalledWith("currententrychange", expect.any(Function));
    } finally {
      Reflect.deleteProperty(window, "navigation");
    }
  });

  it("leaves an address with no personal query value untouched", async () => {
    window.history.replaceState(null, "", "/explore?q=cake&utm_source=news");
    const replace = vi.spyOn(window.history, "replaceState");
    renderHook(useDiscoveryLocation);
    await act(async () => {});
    expect(replace).not.toHaveBeenCalled();
  });
});
