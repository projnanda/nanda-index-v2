/**
 * Where PostHog lives, given its ingestion host (NEXT_PUBLIC_POSTHOG_HOST).
 * PostHog Cloud splits ingestion, static assets and the app across three
 * hosts per region; a self-hosted instance serves all three itself.
 *
 * No "@/" imports here: next.config.ts loads this file at build time.
 */

export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

/**
 * The configured ingestion host, or the default. Empty counts as unset: the
 * Dockerfile passes an empty string when the build arg is missing.
 */
export function configuredPostHogHost(value: string | undefined): string {
  return value?.trim() || DEFAULT_POSTHOG_HOST;
}

export interface PostHogHosts {
  /** Event ingestion and remote config (proxied at /ingest). */
  readonly api: string;
  /** posthog-js extensions such as the session recorder (proxied at /ingest/static). */
  readonly assets: string;
  /** The PostHog app, for links from the toolbar. */
  readonly ui: string;
}

const CLOUD_INGEST_HOST = /^https:\/\/(us|eu)\.i\.posthog\.com$/;

export function posthogHosts(host: string): PostHogHosts {
  const api = host.replace(/\/+$/, "");
  const region = CLOUD_INGEST_HOST.exec(api)?.[1];
  if (!region) return { api, assets: api, ui: api };
  return {
    api,
    assets: `https://${region}-assets.i.posthog.com`,
    ui: `https://${region}.posthog.com`,
  };
}
