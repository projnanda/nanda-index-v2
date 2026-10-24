// Spike: steady reads, a sudden burst, then steady again. Passes if latency
// returns to its pre-spike level once the burst ends — a server that stays
// slow afterwards is still draining a backlog (or has leaked something).
//
//   BASE_RATE     requests/s before and after      (default 20)
//   SPIKE_RATE    requests/s during the burst      (default 300)
//   SPIKE_SECONDS burst length                     (default 60)

import { MAX_VUS, intEnv, thresholdsFor } from './lib/config.js';
import { weighted } from './lib/data.js';
import { READ_MIX, READ_NAMES } from './lib/mixes.js';

const BASE = intEnv('BASE_RATE', 20);
const SPIKE = intEnv('SPIKE_RATE', 300);
const SPIKE_SECONDS = intEnv('SPIKE_SECONDS', 60);

export const options = {
  discardResponseBodies: true,
  scenarios: {
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: BASE,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: MAX_VUS,
      stages: [
        { target: BASE, duration: '60s' },
        { target: SPIKE, duration: '5s' },
        { target: SPIKE, duration: `${SPIKE_SECONDS}s` },
        { target: BASE, duration: '5s' },
        { target: BASE, duration: '120s' },
      ],
    },
  },
  thresholds: thresholdsFor(READ_NAMES),
};

export default function () {
  weighted(READ_MIX)();
}
