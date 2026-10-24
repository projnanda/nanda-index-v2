// Stress: agentic and ARD search on a rising staircase. Each request ranks
// orgs in Postgres, then calls up to ~20 enterprise registries (the stub,
// which answers after LT_STUB_LATENCY_MS), five at a time per ranked set.
//
//   MAX_RATE      searches/s at the top step       (default 60)
//   STEPS         number of equal steps            (default 6)
//   STEP_SECONDS  hold time per step               (default 30)

import { MAX_VUS, intEnv, staircase, thresholdsFor } from './lib/config.js';
import { weighted } from './lib/data.js';
import { AGENTIC_MIX, AGENTIC_NAMES } from './lib/mixes.js';

export const options = {
  discardResponseBodies: true,
  scenarios: {
    agentic: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: MAX_VUS,
      stages: staircase(intEnv('MAX_RATE', 60), intEnv('STEPS', 6), intEnv('STEP_SECONDS', 30)),
    },
  },
  thresholds: thresholdsFor(AGENTIC_NAMES),
};

export default function () {
  weighted(AGENTIC_MIX)();
}
