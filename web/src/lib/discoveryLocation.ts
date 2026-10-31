"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";

const KEYS = ["q", "owner", "protocol", "page", "entry", "locator", "mode", "urn", "example"] as const;
type Key = (typeof KEYS)[number];
export type DiscoveryState = Partial<Record<Key, string>>;
const CHANGE_EVENT = "nanda:discovery-location";
export const LINK_PRIVACY_NOTE = "Personal identifiers and email searches use the link fragment, which stays out of page requests. They remain in browser history and shared links, and are sent to the API when you search or resolve.";

export function isPersonalValue(value: string): boolean {
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { /* Keep literal malformed escapes. */ }
  return decoded.includes("@") || /^urn:air:[^:]+:personal:/i.test(decoded);
}
export function readDiscoveryState(address: string): DiscoveryState {
  const url = new URL(address || "/", "https://discovery.invalid");
  const fragment = new URLSearchParams(url.hash.slice(1));
  const state: DiscoveryState = {};
  for (const key of KEYS) {
    const value = fragment.get(key) ?? url.searchParams.get(key);
    if (value) state[key] = value;
  }
  return state;
}
export function discoveryLink(path: string, state: DiscoveryState): string {
  const query = new URLSearchParams();
  const fragment = new URLSearchParams();
  for (const key of KEYS) {
    const value = state[key];
    if (value) (isPersonalValue(value) ? fragment : query).set(key, value);
  }
  return path + (query.size ? `?${query}` : "") + (fragment.size ? `#${fragment}` : "");
}
export function selectedValues<T extends string>(value: string | undefined, labels: Record<T, string>): Set<T> {
  return new Set((value ?? "").split(",").filter((key): key is T => Object.hasOwn(labels, key)));
}
export function pageNumber(value: string | undefined): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}
const snapshot = () => window.location.search + window.location.hash;
const serverSnapshot = () => "";
function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("hashchange", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("hashchange", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}
export function navigateDiscovery(patch: DiscoveryState, replace = false): boolean {
  const target = discoveryLink(window.location.pathname, { ...readDiscoveryState(window.location.href), ...patch });
  if (target === window.location.pathname + snapshot()) return false;
  window.history[replace ? "replaceState" : "pushState"](window.history.state, "", target);
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return true;
}
export function useDiscoveryLocation() {
  const address = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const state = useMemo(() => readDiscoveryState(address), [address]);
  useEffect(() => {
    // A legacy incoming URL may already have exposed a value on its first page
    // request. Keep subsequent history/navigation from repeating that exposure.
    const query = new URLSearchParams(window.location.search);
    if (KEYS.some((key) => isPersonalValue(query.get(key) ?? ""))) navigateDiscovery({}, true);
  }, [address]);
  return { state, address };
}
