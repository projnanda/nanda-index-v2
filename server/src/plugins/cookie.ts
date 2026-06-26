import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { buildConfig } from '../config/index.js';

/**
 * Registers @fastify/cookie — needed for the OAuth state CSRF cookie.
 * The signing secret comes from config (COOKIE_SECRET); production refuses
 * to start with the default dev secret (see config/index.ts).
 */
export async function registerCookiePlugin(fastify: FastifyInstance): Promise<void> {
  const config = buildConfig();
  await fastify.register(cookie, { secret: config.cookie.secret });
}
