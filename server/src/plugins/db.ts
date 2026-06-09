import type { FastifyInstance } from 'fastify';
import type postgres from 'postgres';
import { getSql, closeSql } from '../db/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: ReturnType<typeof postgres>;
  }
}

/**
 * Decorates the Fastify instance with `fastify.db` (the shared postgres.js
 * client) and registers an onClose hook that drains the connection pool on
 * graceful shutdown (SIGTERM/SIGINT via server.ts).
 *
 * Call directly on the root instance (not via fastify.register) so the
 * decoration is visible to all child plugins without needing fastify-plugin.
 */
export async function registerDb(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('db', getSql());
  fastify.addHook('onClose', async () => {
    await closeSql();
  });
}
