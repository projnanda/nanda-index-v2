import type { FastifyRequest } from 'fastify';

/**
 * Keeps secrets out of the request log.
 *
 * Fastify's default request serializer logs `request.url` whole, query string
 * included, so every single-use credential that travels in a query string ends
 * up in the log in cleartext: the org verification token on
 * `GET /api/v1/verify-email?token=…` (routes/index-records.ts) and the OAuth
 * authorization code on `GET /auth/{google,github}/callback?code=…`. Anyone who
 * can read a log line — an operator, a shipping pipeline, a mounted volume —
 * can replay those. Hashing the verification token at rest (migration 020)
 * does not help while the plaintext sits in the log next to it.
 *
 * The rule here is an allowlist, not a denylist: a parameter's value is logged
 * only if it is named below, and everything else is masked. A denylist would
 * have to be extended every time a route gains a credential-bearing parameter,
 * and the cost of forgetting is a leaked secret. With an allowlist the cost of
 * forgetting is one masked value in a log line, which someone notices and
 * fixes. Matching is exact and case-sensitive for the same reason — `TOKEN`
 * is not in the list, so it is masked.
 */

/**
 * Query parameters whose values are safe to log, taken from the querystring
 * schemas of the public read routes. These are the ones worth having in a log:
 * they are what a request was actually asking for, and none is a credential.
 */
export const LOGGABLE_QUERY_PARAMS: readonly string[] = [
  // search.ts, agentic-search.ts
  'q',
  'limit',
  // resolve.ts
  'locator',
  // index-records.ts (listing)
  'offset',
  // ard.ts
  'pageSize',
  'pageToken',
  'filter',
  // availability.ts
  'org_id',
  'domain',
];

/** Stand-in for a masked value. Distinct enough to grep for in a log. */
export const REDACTED = '[redacted]';

/**
 * A request line Node will accept can be ~16 KB, and all of it would land in
 * the log. Cap what is logged so a long query string cannot be used to bloat
 * the log, while leaving far more than any real request needs.
 */
export const MAX_LOGGED_URL_CHARS = 512;

/**
 * Masks the value of every query parameter that is not in
 * {@link LOGGABLE_QUERY_PARAMS}, and truncates the result.
 *
 * Works on the raw string and never percent-decodes: decoding hostile input
 * only to re-encode it would let the logged URL differ from the one that was
 * requested, which is exactly the thing a log is for. A parameter with no `=`
 * carries no value to leak and is kept as-is.
 */
export function redactUrl(url: string): string {
  const split = url.indexOf('?');
  if (split === -1) return truncate(url);

  const path = url.slice(0, split);
  const query = url.slice(split + 1);
  if (query === '') return truncate(url);

  const redacted = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const key = pair.slice(0, eq);
      return LOGGABLE_QUERY_PARAMS.includes(key) ? pair : `${key}=${REDACTED}`;
    })
    .join('&');

  return truncate(`${path}?${redacted}`);
}

function truncate(value: string): string {
  return value.length > MAX_LOGGED_URL_CHARS ? `${value.slice(0, MAX_LOGGED_URL_CHARS)}…` : value;
}

/**
 * Replaces Fastify's default `req` serializer. Same fields it emits, so
 * existing log consumers keep working; only `url` changes.
 */
export function serializeRequest(request: FastifyRequest): Record<string, unknown> {
  return {
    method: request.method,
    url: redactUrl(request.url),
    host: request.host,
    remoteAddress: request.socket?.remoteAddress,
    remotePort: request.socket?.remotePort,
  };
}
