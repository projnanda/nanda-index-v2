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
