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
