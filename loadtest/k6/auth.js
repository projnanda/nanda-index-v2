// Stress: logins on a rising staircase, with a steady trickle of cheap reads
// alongside. Each login is ~70 ms of bcrypt CPU, so the question is not only
// "how many logins/s" but "what do logins do to everyone else". With bcryptjs
// (main thread) the probe's latency climbed with the login rate; with native
// bcrypt (thread pool, capped by AUTH_MAX_CONCURRENT_HASHES) it should not.
//
//   LOGIN_MAX_RATE  logins/s at the top step       (default 40)
//   STEPS           number of equal steps          (default 8)
//   STEP_SECONDS    hold time per step             (default 20)
//   PROBE_RATE      cheap reads/s throughout       (default 20)

import { MAX_VUS, intEnv, staircase, thresholdsFor } from './lib/config.js';
import { getOrg, login } from './lib/endpoints.js';

const STEPS = intEnv('STEPS', 8);
const STEP_SECONDS = intEnv('STEP_SECONDS', 20);
const TOTAL_SECONDS = STEPS * (STEP_SECONDS + 5);

export const options = {
  discardResponseBodies: true,
  scenarios: {
    logins: {
      executor: 'ramping-arrival-rate',
      exec: 'loginFlow',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: MAX_VUS,
      stages: staircase(intEnv('LOGIN_MAX_RATE', 40), STEPS, STEP_SECONDS),
    },
    probe: {
      executor: 'constant-arrival-rate',
      exec: 'probeFlow',
      rate: intEnv('PROBE_RATE', 20),
      timeUnit: '1s',
      duration: `${TOTAL_SECONDS}s`,
      preAllocatedVUs: 10,
      maxVUs: MAX_VUS,
    },
  },
  thresholds: thresholdsFor(['login', 'index_get']),
};

export function loginFlow() {
  login();
}

export function probeFlow() {
  getOrg();
}
