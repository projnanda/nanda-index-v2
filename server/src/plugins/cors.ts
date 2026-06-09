import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

/**
 * CORS for v1 — all origins allowed.
 * TODO v2: restrict to an explicit allow-list per environment.
 */
export async function registerCors(fastify: FastifyInstance): Promise<void> {
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
}
