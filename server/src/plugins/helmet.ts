import type { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';

/**
 * Registers @fastify/helmet for baseline security response headers
 * (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS, etc.).
 *
 * Content-Security-Policy is left OFF for now: this server hosts Swagger UI
 * (/docs), whose inline scripts/styles a default CSP would block. A tailored
 * CSP is a follow-up; the other headers are safe to enable immediately.
 */
export async function registerHelmet(fastify: FastifyInstance): Promise<void> {
  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });
}
