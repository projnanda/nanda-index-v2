// Stress: public reads on a rising staircase until the API saturates.
//
//   MAX_RATE      requests/s at the top step        (default 500)
//   STEPS         number of equal steps             (default 10)
//   STEP_SECONDS  hold time per step                (default 30)
//
// Open model (arrival rate): requests keep arriving at the set rate however
// slow the server gets, the way real visitors do. A closed model (fixed VUs
// looping) would slow its own sending as the server slowed and hide the knee.

import { MAX_VUS, intEnv, staircase, thresholdsFor } from './lib/config.js';
import { weighted } from './lib/data.js';
import { READ_MIX, READ_NAMES } from './lib/mixes.js';

export const options = {
  discardResponseBodies: true,
  scenarios: {
    reads: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: MAX_VUS,
      stages: staircase(intEnv('MAX_RATE', 500), intEnv('STEPS', 10), intEnv('STEP_SECONDS', 30)),
    },
  },
  thresholds: thresholdsFor(READ_NAMES),
};

export default function () {
  weighted(READ_MIX)();
}
