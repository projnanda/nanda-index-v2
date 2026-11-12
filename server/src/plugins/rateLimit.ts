import type { FastifyInstance } from 'fastify';
import rateLimit, { type errorResponseBuilderContext } from '@fastify/rate-limit';
import { buildConfig } from '../config/index.js';
import { clientNetworkKey } from '../lib/clientNetwork.js';

/**
 * The plugin's default error has no `code`, so its message landed in the
 * envelope's `error` field. Give it a stable code; the wait stays in `detail`.
 * Thrown (not sent) so the global error handler shapes and logs it.
 */
function rateLimitedError(_request: unknown, context: errorResponseBuilderContext): Error {
  return Object.assign(new Error(`Rate limit exceeded, retry in ${context.after}`), {
    statusCode: context.statusCode,
    code: 'RATE_LIMITED',
  });
}

/**
 * Registers @fastify/rate-limit in opt-in mode (`global: false`).
 *
 * Only routes that declare `config.rateLimit` are throttled, keyed by client
 * network (an IPv4 address, or an IPv6 client's /64; see clientNetworkKey). Auth mutation routes (login/register/forgot/reset) opt in to blunt
 * brute-force and mass-signup attacks; public read routes opt in via
 * publicReadRateLimit / searchRateLimit below so one client cannot scrape or
 * hammer the index (agentic and ARD search each fan out to many remote
 * registries, so they get a tighter budget).
 *
 * The default max/window come from config so tests can tune them via env.
 */
export async function registerRateLimit(fastify: FastifyInstance): Promise<void> {
  const config = buildConfig();
  await fastify.register(rateLimit, {
    global: false,
    max: config.auth.rateLimitMax,
    timeWindow: config.auth.rateLimitWindow,
    keyGenerator: (request) => clientNetworkKey(request.ip),
    errorResponseBuilder: rateLimitedError,
  });
}

interface RouteRateLimit {
  rateLimit: { max: number; timeWindow: string };
}

/** Route `config` for cheap public reads (index list/read, keyword search, resolve, ARD listings). */
export function publicReadRateLimit(): RouteRateLimit {
  const { publicRateLimit } = buildConfig();
  return { rateLimit: { max: publicRateLimit.max, timeWindow: publicRateLimit.window } };
}

/** Route `config` for agentic / ARD search, which fan out to remote registries. */
export function searchRateLimit(): RouteRateLimit {
  const { publicRateLimit } = buildConfig();
  return { rateLimit: { max: publicRateLimit.searchMax, timeWindow: publicRateLimit.window } };
}
