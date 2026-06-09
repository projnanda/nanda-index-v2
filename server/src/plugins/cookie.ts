import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';

/** Registers @fastify/cookie — needed for OAuth state CSRF cookie. */
export async function registerCookiePlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(cookie, { secret: undefined });
}
