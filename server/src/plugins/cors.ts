import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import { buildConfig } from '../config/index.js';

/**
 * CORS for v1 — all origins allowed, without credentials.
 * TODO v2: restrict to an explicit allow-list per environment.
 *
 * Only the web app's own origin (FRONTEND_URL) may send credentials (cookies):
 * its OAuth callback page POSTs to /auth/exchange with the HttpOnly login
 * nonce cookie. Every other origin still gets a plain, credential-less answer,
 * so it can only send credentials it already holds (a bearer token).
 */
export async function registerCors(fastify: FastifyInstance): Promise<void> {
  const frontendOrigin = new URL(buildConfig().frontendUrl).origin;
  await fastify.register(cors, {
    delegator: (request, callback) => {
      callback(null, {
        origin: true,
        credentials: request.headers.origin === frontendOrigin,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
        allowedHeaders: ['Content-Type', 'Authorization'],
      });
    },
  });
}
