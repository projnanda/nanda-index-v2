"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

// Explore, Discover and Resolve keep their view in the address bar, so a view
// survives a reload, works with back and forward, and can be shared as a link.
//
// Email addresses and personal identifiers go in the fragment (#), which the
// browser never sends with a page request, so they stay out of access logs.
// Everything else goes in the query string.

export const DISCOVERY_KEYS = ["q", "owner", "protocol", "page", "entry", "locator", "mode", "urn", "example"] as const;
export type DiscoveryKey = (typeof DISCOVERY_KEYS)[number];
export type DiscoveryState = Partial<Record<DiscoveryKey, string>>;

export const LINK_PRIVACY_NOTE =
  "Personal identifiers and email searches use the link fragment, which stays out of page requests. They remain in browser history and shared links, and are sent to the API when you search or resolve.";

const CHANGE_EVENT = "nanda:discovery-location";
const PERSONAL_URN = /^urn:air:[^:]+:personal:/i;
// Only the path, query and fragment of an address are read, so any base works.
const PARSE_BASE = "https://discovery.invalid";

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed escape is not an encoding of anything: judge the literal text.
    return value;
  }
}

/** True for a value that must stay out of page request URLs: an email or a personal identifier. */
export function isPersonalValue(value: string): boolean {
  const decoded = safeDecode(value);
  return decoded.includes("@") || PERSONAL_URN.test(decoded);
}

/** Read the view from an address. A fragment value wins over the same key in the query. */
export function readDiscoveryState(address: string): DiscoveryState {
  const url = new URL(address || "/", PARSE_BASE);
  const fragment = new URLSearchParams(url.hash.slice(1));
  return DISCOVERY_KEYS.reduce<DiscoveryState>((state, key) => {
    const value = fragment.get(key) ?? url.searchParams.get(key);
    return value ? { ...state, [key]: value } : state;
  }, {});
}

/**
 * Build a link to `path` showing `state`. Personal values go in the fragment.
 * `otherQuery` carries query parameters that are not part of the view (campaign
 * tags, for example) so that changing the view does not drop them.
 */
export function discoveryLink(path: string, state: DiscoveryState, otherQuery?: URLSearchParams): string {
  const query = new URLSearchParams(otherQuery);
  const fragment = new URLSearchParams();
  for (const key of DISCOVERY_KEYS) {
    query.delete(key);
    const value = state[key];
    if (value) (isPersonalValue(value) ? fragment : query).set(key, value);
  }
  return path + (query.size ? `?${query}` : "") + (fragment.size ? `#${fragment}` : "");
}

/** Parse a comma-separated selection, keeping only the options that exist. */
export function selectedValues<T extends string>(value: string | undefined, labels: Record<T, string>): ReadonlySet<T> {
  return new Set((value ?? "").split(",").filter((key): key is T => Object.hasOwn(labels, key)));
}

/** Serialise a selection in a stable order, so the same view always has the same link. */
export function selectionParam(selected: ReadonlySet<string>): string {
  return [...selected].sort().join(",");
}

/** A 1-based page number; anything that is not a positive integer is page 1. */
export function pageNumber(value: string | undefined): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

const snapshot = () => window.location.search + window.location.hash;
const serverSnapshot = () => "";

function subscribe(callback: () => void) {
  const events = ["popstate", "hashchange", CHANGE_EVENT];
  events.forEach((name) => window.addEventListener(name, callback));

  // A site link back to the page already open (the header's "Explore" link
  // while Explore is filtered, say) changes the address through the framework's
  // router, which fires none of the events above. The Navigation API reports
  // every address change. It can fire while React is committing, so the
  // re-read waits for that to finish. Browsers without the API keep working;
  // they only miss this one case.
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  const onEntryChange = () => queueMicrotask(callback);
  navigation?.addEventListener("currententrychange", onEntryChange);

  return () => {
    events.forEach((name) => window.removeEventListener(name, callback));
    navigation?.removeEventListener("currententrychange", onEntryChange);
  };
}

/**
 * Apply `patch` to the current view and put the result in the address bar. An
 * empty string removes a key. `replace` rewrites the current history entry
 * instead of adding one. Returns false when the address did not change.
 */
export function navigateDiscovery(patch: DiscoveryState, replace = false): boolean {
  const next = { ...readDiscoveryState(window.location.href), ...patch };
  const target = discoveryLink(window.location.pathname, next, new URLSearchParams(window.location.search));
  if (target === window.location.pathname + snapshot()) return false;
  try {
    // A null state is the form Next.js documents for keeping its router in step.
    window.history[replace ? "replaceState" : "pushState"](null, "", target);
  } catch {
    // Browsers cap how often history may change. The view on screen is still
    // right; only this address update is skipped.
    return false;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return true;
}

/** The view held in the address bar, re-read on every history change. */
export function useDiscoveryLocation(): { state: DiscoveryState; address: string } {
  const address = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const state = useMemo(() => readDiscoveryState(address), [address]);
  useEffect(() => {
    // An older link may carry a personal value in its query string. That first
    // page request has already been made; rewriting the address keeps reloads
    // and history from repeating it.
    const query = new URLSearchParams(window.location.search);
    if (DISCOVERY_KEYS.some((key) => isPersonalValue(query.get(key) ?? ""))) navigateDiscovery({}, true);
  }, [address]);
  return { state, address };
}
