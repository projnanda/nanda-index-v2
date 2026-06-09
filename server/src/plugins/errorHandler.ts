import type { FastifyInstance, FastifyError } from 'fastify';
import type { ApiError } from '../types/api/common.js';

/**
 * Registers a global Fastify error handler that:
 * - Never leaks stack traces or internal messages to callers
 * - Logs the full error internally via fastify.log
 * - Returns the ApiError shape for all failures
 */
export async function registerErrorHandler(fastify: FastifyInstance): Promise<void> {
  fastify.setErrorHandler<FastifyError>((error, request, reply) => {
    const status = error.statusCode ?? 500;

    // Log full error internally — never surfaces to the client
    fastify.log.error({ err: error, method: request.method, url: request.url }, 'request error');

    const body: ApiError = {
      error: status >= 500 ? 'internal_server_error' : (error.code ?? error.message ?? 'error'),
    };

    // Include detail only for 4xx — 5xx errors must not reveal internals
    if (status < 500 && error.message) {
      body.detail = error.message;
    }

    return reply.status(status).send(body);
  });
}
