// Weighted request mixes, as [[weight, fn], ...] for data.js#weighted.

import * as api from './endpoints.js';

/** Public browsing and lookups: what the web app and API clients do most. */
export const READ_MIX = [
  [25, api.getOrg],
  [20, api.resolve],
  [18, api.searchHit],
  [7, api.searchMiss],
  [15, api.listIndex],
  [10, api.ardAgents],
  [5, api.ardExplore],
];

export const READ_NAMES = [
  'index_get', 'resolve', 'search_hit', 'search_miss', 'index_list', 'ard_agents', 'ard_explore',
];

/** Natural-language search, each call fanning out to remote registries. */
export const AGENTIC_MIX = [
  [80, api.agenticSearch],
  [20, api.ardSearch],
];

export const AGENTIC_NAMES = ['agentic_search', 'ard_search'];

/** A day-in-the-life blend for the soak test. */
export const BLENDED_MIX = [
  [90, READ_MIX],
  [6, AGENTIC_MIX],
  [4, [[1, api.login]]],
];

export const BLENDED_NAMES = [...READ_NAMES, ...AGENTIC_NAMES, 'login'];
