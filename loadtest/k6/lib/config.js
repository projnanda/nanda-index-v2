// Settings shared by every scenario, read from `k6 run -e NAME=value`.
// Defaults match seed/seed.sql and docker-compose.yml.

export function intEnv(name, fallback) {
  const parsed = parseInt(__ENV[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3101').replace(/\/+$/, '');

/** Must match the seed: k6 addresses orgs as lt-1 .. lt-ORG_COUNT. */
export const ORG_COUNT = intEnv('ORG_COUNT', 100);
export const USER_COUNT = intEnv('USER_COUNT', 200);
export const PASSWORD = __ENV.LT_PASSWORD || 'LoadTest-Passw0rd!';

/** Upper bound on concurrent virtual users. When the server slows down an
 *  arrival-rate scenario needs more VUs to keep the rate; once this cap is
 *  hit k6 reports dropped_iterations — a saturation signal in itself. */
export const MAX_VUS = intEnv('MAX_VUS', 1000);

/**
 * Pass/fail lines for the end-of-run summary. Not used to abort: a stress
 * test is meant to cross them, and the summary shows where.
 */
export function thresholdsFor(names) {
  const perEndpoint = Object.fromEntries(
    names.map((name) => [`http_req_duration{name:${name}}`, ['p(95)<500']]),
  );
  return {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    dropped_iterations: ['count<1'],
    ...perEndpoint,
  };
}

/**
 * `steps` equal rate increments up to maxRate, each ramped over 5s and held
 * for stepSeconds — a staircase, so each step's latency can be read on its
 * own (run.sh / summarize.py bucket by time).
 */
export function staircase(maxRate, steps, stepSeconds) {
  return Array.from({ length: steps }, (_, i) => Math.round((maxRate * (i + 1)) / steps))
    .flatMap((rate) => [
      { target: rate, duration: '5s' },
      { target: rate, duration: `${stepSeconds}s` },
    ]);
}
