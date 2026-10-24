// One function per API call under test. Each tags its request with `name`,
// which groups dynamic URLs into one series (search?q=travel and search?q=crm
// are both "search") for thresholds, the summary and summarize.py.

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE_URL, ORG_COUNT, PASSWORD } from './config.js';
import {
  identifierFor, matchingQuery, missingQuery, orgId, randomOrgNumber,
  randomUserEmail, taskQuery,
} from './data.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const PAGE_SIZE = 20;
const BROWSED_PAGES = Math.max(1, Math.min(20, Math.ceil(ORG_COUNT / PAGE_SIZE)));

// Counted when a request is sent, not when it completes: with
// dropped_iterations this is the load offered, which summarize.py sets
// beside the load served.
const offered = new Counter('offered');

function get(path, name, params = {}) {
  offered.add(1, { name });
  const res = http.get(`${BASE_URL}${path}`, { ...params, tags: { name } });
  check(res, { [`${name} 200`]: (r) => r.status === 200 });
  return res;
}

function post(path, body, name, params = {}) {
  offered.add(1, { name });
  const res = http.post(`${BASE_URL}${path}`, JSON.stringify(body), {
    ...params,
    headers: JSON_HEADERS,
    tags: { name },
  });
  check(res, { [`${name} 200`]: (r) => r.status === 200 });
  return res;
}

// Fan-out failures are swallowed server-side (the search still answers 200),
// so agentic calls keep their body and check it.
const KEEP_BODY = { responseType: 'text' };

function jsonField(res, field) {
  try {
    return res.json(field);
  } catch {
    return undefined;
  }
}

/** GET /api/v1/index — one of the first pages that exist, as browsing does. */
export function listIndex() {
  const offset = Math.floor(Math.random() * BROWSED_PAGES) * PAGE_SIZE;
  return get(`/api/v1/index?limit=${PAGE_SIZE}&offset=${offset}`, 'index_list');
}

/** GET /api/v1/index/:org_id — one entry by primary key. */
export function getOrg() {
  return get(`/api/v1/index/${orgId(randomOrgNumber())}`, 'index_get');
}

/** GET /api/v1/resolve — urn:air: identifier to discovery object. */
export function resolve() {
  const locator = encodeURIComponent(identifierFor(randomOrgNumber()));
  return get(`/api/v1/resolve?locator=${locator}`, 'resolve');
}

/** GET /api/v1/search — keyword search that finds rows. */
export function searchHit() {
  return get(`/api/v1/search?q=${encodeURIComponent(matchingQuery())}`, 'search_hit');
}

/** GET /api/v1/search — keyword search that finds nothing (still scans). */
export function searchMiss() {
  return get(`/api/v1/search?q=${missingQuery()}`, 'search_miss');
}

/** GET /api/ard/agents — ARD listing, cursor-paged. */
export function ardAgents() {
  return get(`/api/ard/agents?pageSize=${PAGE_SIZE}`, 'ard_agents');
}

/** POST /api/ard/explore — facet counts over every active entry. */
export function ardExplore() {
  return post('/api/ard/explore', {
    resultType: { facets: [{ field: 'type' }, { field: 'tags' }] },
  }, 'ard_explore');
}

/** GET /api/v1/agentic-search — rank, then fan out to the stub registry. */
export function agenticSearch() {
  const q = encodeURIComponent(taskQuery());
  const res = get(`/api/v1/agentic-search?q=${q}`, 'agentic_search', KEEP_BODY);
  check(res, {
    'agentic_search reached every registry': (r) => (jsonField(r, 'orgsUnreachable') ?? ['?']).length === 0,
  });
  return res;
}

/** POST /api/ard/search — the ARD wrapper around agentic search. */
export function ardSearch() {
  const res = post('/api/ard/search', { query: { text: taskQuery() }, pageSize: PAGE_SIZE }, 'ard_search', KEEP_BODY);
  check(res, {
    'ard_search returned results': (r) => (jsonField(r, 'results') ?? []).length > 0,
  });
  return res;
}

/** POST /auth/login — a bcrypt compare (cost 10) per call. */
export function login() {
  return post('/auth/login', { email: randomUserEmail(), password: PASSWORD }, 'login');
}
