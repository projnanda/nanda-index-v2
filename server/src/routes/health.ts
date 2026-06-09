import type { FastifyInstance } from 'fastify';
import { healthOkSchema } from '../types/api/health.js';
import { apiErrorSchema } from '../types/api/common.js';

/**
 * GET /health — liveness + DB reachability probe.
 *
 * Returns 200 with `{ status: 'ok', db: 'ok' }` when Postgres responds
 * to a `SELECT 1`. Returns 503 with the ApiError shape when the DB is
 * unreachable. No auth, no caching — used by orchestrators and uptime
 * monitors.
 */
export async function registerHealthRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/health',
    {
      schema: {
        response: {
          200: healthOkSchema,
          503: apiErrorSchema,
        },
      },
    },
    async (_request, reply) => {
      try {
        await fastify.db`SELECT 1`;
        return { status: 'ok', db: 'ok' };
      } catch (err) {
        fastify.log.error({ err }, 'health: db ping failed');
        return reply.status(503).send({
          error: 'db_unreachable',
          detail: 'database ping failed',
          endpoint: '/health',
        });
      }
    },
  );
}
