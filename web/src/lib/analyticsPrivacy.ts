import type { CaptureResult, CapturedNetworkRequest } from "posthog-js";

/**
 * What analytics may never see. Some pages carry a secret in their URL — a
 * password-reset token (/reset-password?token=…), a session JWT
 * (/auth/callback?token=…) — so no analytics tool loads on them, and every
 * URL that does leave the browser loses its query string and fragment.
 */

const PRIVATE_PATH_PREFIXES = ["/reset-password", "/auth/", "/verify-email", "/verify-account", "/dashboard/settings"];

export function isPrivatePath(pathname: string): boolean {
  return PRIVATE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function stripQueryAndHash(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

const ABSOLUTE_URL = /^https?:\/\//i;
// Link targets inside an autocaptured `$elements_chain`, e.g. attr__href="/x?token=…".
const HREF_ATTRIBUTE_QUERY = /(href=")([^"?#]*)[?#][^"]*"/g;
const HREF_KEYS = new Set(["href", "attr__href"]);
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function scrubString(value: string, key: string): string {
  const url = HREF_KEYS.has(key) || ABSOLUTE_URL.test(value) ? stripQueryAndHash(value) : value;
  return url.replace(HREF_ATTRIBUTE_QUERY, '$1$2"').replace(EMAIL, "[email]");
}

function scrubValue(value: unknown, key = ""): unknown {
  if (typeof value === "string") return scrubString(value, key);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubValue(v, k)]));
  }
  return value;
}

/**
 * PostHog `before_send`: drops everything captured on a private page and
 * returns a copy of any other event with URL secrets and email addresses
 * removed from its properties (page URLs, referrers, clicked link targets,
 * element text).
 *
 * Session-replay snapshots pass through untouched: their payload is
 * compressed DOM, and the page URLs the recorder adds to it are already
 * masked by `scrubNetworkRequest` when they are recorded.
 */
export function scrubEvent(event: CaptureResult | null, pathname: string): CaptureResult | null {
  if (!event || isPrivatePath(pathname)) return null;
  if (event.event === "$snapshot") return event;
  return {
    ...event,
    properties: scrubValue(event.properties) as CaptureResult["properties"],
    ...(event.$set && { $set: scrubValue(event.$set) as CaptureResult["$set"] }),
    ...(event.$set_once && { $set_once: scrubValue(event.$set_once) as CaptureResult["$set_once"] }),
  };
}

// Attributes that hold a link or form target. Image sources are left whole:
// here they are public assets (next/image), and stripping them blanks replays.
const LINK_ATTRIBUTES = new Set(["href", "action", "formaction"]);

/**
 * PostHog `session_recording.maskAttributeFn`. Text masking hides text nodes
 * but not attributes, so a link on screen would otherwise reach the replay
 * with its query string (?token=…, a search term) and a mailto: its address.
 */
export function scrubReplayAttribute(name: string, value: string): string {
  const target = LINK_ATTRIBUTES.has(name) ? stripQueryAndHash(value) : value;
  return target.replace(EMAIL, "[email]");
}

/**
 * PostHog `session_recording.maskCapturedNetworkRequestFn`. The recorder
 * passes both network requests and every page URL it records through this,
 * so it is where replay URLs lose their query strings.
 */
export function scrubNetworkRequest(request: CapturedNetworkRequest): CapturedNetworkRequest {
  return { ...request, name: stripQueryAndHash(request.name) };
}
