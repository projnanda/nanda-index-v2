import type { CaptureResult, CapturedNetworkRequest } from "posthog-js";

/**
 * What analytics may never see. Some pages carry a secret in their URL — a
 * password-reset token (/reset-password?token=…), a one-time OAuth sign-in
 * code (/auth/callback?code=…) — so no analytics tool loads on them, and
 * every URL that does leave the browser loses its query string and fragment.
 */

// Sign-in and account pages are never measured either (see /privacy): the
// dashboard shows contact emails and domain-verification challenges.
const PRIVATE_PATHS = [
  "/reset-password",
  "/auth",
  "/verify-email",
  "/verify-account",
  "/login",
  "/register",
  "/forgot-password",
  "/dashboard",
];

/** True for a private page or anything below it (`/dashboard/orgs/1`, not `/dashboards`). */
export function isPrivatePath(pathname: string): boolean {
  return PRIVATE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function stripQueryAndHash(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

const ABSOLUTE_URL = /^https?:\/\//i;
// Link targets inside an autocaptured `$elements_chain`, e.g. attr__href="/x?token=…".
const HREF_ATTRIBUTE_QUERY = /(href=")([^"?#]*)[?#][^"]*"/g;
const HREF_KEYS = new Set(["href", "attr__href"]);
// Also matches a URL-encoded "@" (%40), apostrophes and non-ASCII letters.
const EMAIL = /[\p{L}\p{N}._%+'-]+(?:@|%40)[\p{L}\p{N}.-]+\.\p{L}{2,}/giu;
const MAY_HOLD_EMAIL = /@|%40/i;

/** Replaces every email address, plain or URL-encoded, with "[email]". */
export function redactEmails(value: string): string {
  // Cheap pre-check: replay runs this on every text node on the page.
  return MAY_HOLD_EMAIL.test(value) ? value.replace(EMAIL, "[email]") : value;
}

function scrubString(value: string, key: string): string {
  const url = HREF_KEYS.has(key) || ABSOLUTE_URL.test(value) ? stripQueryAndHash(value) : value;
  return redactEmails(url.replace(HREF_ATTRIBUTE_QUERY, '$1$2"'));
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
 * PostHog `session_recording.maskAttributeFn`. Replay text goes through
 * `scrubReplayText`, but attributes are recorded separately, so a link on
 * screen would otherwise reach the replay with its query string (?token=…,
 * a search term) and a mailto: its address.
 */
export function scrubReplayAttribute(name: string, value: string): string {
  const target = LINK_ATTRIBUTES.has(name) ? stripQueryAndHash(value) : value;
  return redactEmails(target);
}

/** PostHog's own class for text that a replay must never show. */
export const REPLAY_MASK_CLASS = "ph-mask";
const REPLAY_MASK_SELECTOR = `.${REPLAY_MASK_CLASS}`;

/**
 * Put this on any element on a public page that shows personal data or
 * repeats what the visitor typed (the signed-in name, a search term in
 * "results for …", an error quoting the input). `ph-mask` stars its text out
 * of replays; `ph-sensitive` keeps its text out of autocaptured click events
 * (`$el_text`), which replay masking does not touch.
 */
export const PERSONAL_DATA_CLASS = `${REPLAY_MASK_CLASS} ph-sensitive`;

/**
 * PostHog `session_recording.maskTextFn`. With `maskTextSelector: "*"` the
 * recorder passes every text node here instead of starring it out, so page
 * content stays readable in replays while email addresses are redacted and
 * text inside a `REPLAY_MASK_CLASS` element is masked in full.
 */
export function scrubReplayText(text: string, element?: HTMLElement | null): string {
  if (element?.closest(REPLAY_MASK_SELECTOR)) return text.replace(/\S/g, "*");
  return redactEmails(text);
}

/**
 * PostHog `session_recording.maskCapturedNetworkRequestFn`. The recorder
 * passes both network requests and every page URL it records through this,
 * so it is where replay URLs lose their query strings.
 */
export function scrubNetworkRequest(request: CapturedNetworkRequest): CapturedNetworkRequest {
  return { ...request, name: stripQueryAndHash(request.name) };
}
