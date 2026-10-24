/**
 * Vitest setup — loads .env so integration tests inherit DATABASE_URL
 * and SIGNING_PRIVATE_KEY without requiring shell-level env loading.
 *
 * `process.loadEnvFile` is Node 20.12+. Silently no-ops if .env is
 * absent (CI/prod test runs that get env vars from elsewhere).
 */
try {
  process.loadEnvFile('.env');
} catch {
  // .env is optional — env vars may come from the shell or CI
}

// Integration tests register registries on fake *.example.com hosts that have
// no real DNS, so the agentic-search SSRF guard is off by default here. Tests
// that exercise the guard set OUTBOUND_ALLOW_PRIVATE_HOSTS=false explicitly.
process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'] ??= 'true';

// Suites register many orgs from one test user and one IP; the production
// anti-abuse limits would trip them. Tests that exercise a limit set it.
process.env['MAX_UNPROVEN_ORGS_PER_USER'] ??= '1000';
process.env['ORG_WRITE_RATE_LIMIT_MAX'] ??= '10000';

// Every inject() comes from 127.0.0.1, so suites would share one per-IP
// budget on the public read routes. Raise it; rate-limit-public.test.ts
// lowers it explicitly to exercise the 429.
process.env['PUBLIC_RATE_LIMIT_MAX'] ??= '100000';
process.env['SEARCH_RATE_LIMIT_MAX'] ??= '100000';

// Suites insert entries and read the index total and ARD facets straight
// back; a cached count would hide their rows. Assigned, not defaulted, so a
// value in .env cannot turn the cache on; index-stats-cache.test.ts turns it
// on itself to test it.
process.env['INDEX_STATS_CACHE_SECONDS'] = '0';
