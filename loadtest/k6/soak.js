// Soak: a moderate, realistic blend held for a long time. Looks for what only
// shows up over time — memory that keeps growing (see stats.csv), latency that
// drifts upward, connections that run out.
//
//   SOAK_RATE     requests/s                       (default 50)
//   SOAK_MINUTES  duration                         (default 30)

import { MAX_VUS, intEnv, thresholdsFor } from './lib/config.js';
import { weighted } from './lib/data.js';
import { BLENDED_MIX, BLENDED_NAMES } from './lib/mixes.js';

export const options = {
  discardResponseBodies: true,
  scenarios: {
    soak: {
      executor: 'constant-arrival-rate',
      rate: intEnv('SOAK_RATE', 50),
      timeUnit: '1s',
      duration: `${intEnv('SOAK_MINUTES', 30)}m`,
      preAllocatedVUs: 50,
      maxVUs: MAX_VUS,
    },
  },
  thresholds: thresholdsFor(BLENDED_NAMES),
};

export default function () {
  // BLENDED_MIX picks a sub-mix first, then a request from it.
  weighted(weighted(BLENDED_MIX))();
}
