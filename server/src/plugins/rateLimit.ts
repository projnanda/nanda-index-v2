import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { buildConfig } from '../config/index.js';

/**
 * Registers @fastify/rate-limit in opt-in mode (`global: false`).
 *
 * Only routes that declare `config.rateLimit` are throttled — the public
 * registry read endpoints (search/resolve/index) stay unlimited. Auth
 * mutation routes (login/register/forgot/reset) opt in, keyed by client IP,
 * to blunt brute-force and mass-signup attacks.
 *
 * The default max/window come from config so tests can tune them via env.
 */
export async function registerRateLimit(fastify: FastifyInstance): Promise<void> {
  const config = buildConfig();
  await fastify.register(rateLimit, {
    global: false,
    max: config.auth.rateLimitMax,
    timeWindow: config.auth.rateLimitWindow,
  });
}
