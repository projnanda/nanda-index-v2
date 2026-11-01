/**
 * Where the public API and its reference live, for pages that link to them.
 * The web app is built against NEXT_PUBLIC_NANDA_INDEX_API_URL; when it is
 * unset the public production API is documented, so the Developers page is
 * never left without an origin to show.
 */
export const DEFAULT_API_BASE_URL = "https://api.nandaindex.org";

export function apiBaseUrl(raw = process.env.NEXT_PUBLIC_NANDA_INDEX_API_URL): string {
  const value = raw?.trim();
  return (value ? value : DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

/** Swagger UI, generated from the API's own route schemas. */
export function apiDocsUrl(base = apiBaseUrl()): string {
  return `${base}/docs`;
}

/** The OpenAPI document behind Swagger UI, for code generation. */
export function openApiUrl(base = apiBaseUrl()): string {
  return `${base}/docs/json`;
}
