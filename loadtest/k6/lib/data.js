// Request inputs derived from the seed's deterministic rows (seed/seed.sql).

import { ORG_COUNT, USER_COUNT } from './config.js';

// Same word lists the seed builds names, descriptions and tags from.
const CATEGORIES = [
  'travel', 'payments', 'email', 'calendar', 'weather', 'legal', 'health',
  'shipping', 'analytics', 'support', 'recruiting', 'crm', 'security',
  'translation', 'finance', 'retail', 'education', 'insurance', 'realestate',
  'logistics',
];
const TASKS = [
  'booking', 'invoicing', 'scheduling', 'search', 'tracking', 'reporting',
  'onboarding', 'compliance', 'forecasting', 'routing', 'summarization',
  'notifications',
];
const TASK_PHRASES = [
  'help me book a flight to Boston',
  'send a transactional email to my customers',
  'track a shipping container',
  'summarize legal contracts',
  'forecast retail demand for next quarter',
  'schedule interviews for recruiting',
];

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function randomOrgNumber() {
  return 1 + Math.floor(Math.random() * ORG_COUNT);
}

export function orgId(n) {
  return `lt-${n}`;
}

/** The seed gives catalogs (n % 10 = 0) :catalog:root and everything else :agent:main. */
export function identifierFor(n) {
  const suffix = n % 10 === 0 ? 'catalog:root' : 'agent:main';
  return `urn:air:lt-${n}.loadtest.example:${suffix}`;
}

/** Words that occur in seeded names, descriptions or tags. */
export function matchingQuery() {
  return Math.random() < 0.5 ? pick(CATEGORIES) : `${pick(CATEGORIES)} ${pick(TASKS)}`;
}

/** A term no seeded row contains: the scan finds nothing and returns empty. */
export function missingQuery() {
  return `zqx${Math.floor(Math.random() * 1e6)}`;
}

/** Natural-language task, the shape agentic search is built for. */
export function taskQuery() {
  return Math.random() < 0.5 ? pick(TASK_PHRASES) : `${pick(TASKS)} for ${pick(CATEGORIES)}`;
}

export function randomUserEmail() {
  return `lt-user-${1 + Math.floor(Math.random() * USER_COUNT)}@loadtest.example`;
}

/**
 * Picks one entry from [[weight, value], ...] proportionally to weight.
 * Weights need not sum to 100.
 */
export function weighted(entries) {
  const total = entries.reduce((sum, [w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [w, value] of entries) {
    if (roll < w) return value;
    roll -= w;
  }
  return entries[entries.length - 1][1];
}
