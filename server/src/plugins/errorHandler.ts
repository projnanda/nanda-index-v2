import type { FastifyInstance, FastifyError } from 'fastify';
import type { ApiError } from '../types/api/common.js';
import { redactUrl } from '../lib/logRedaction.js';
import { validationField } from '../lib/validationErrors.js';

/**
 * Code for a 4xx error that carries none of its own. Without it the error
 * message would end up in `error`, which clients match on as a code.
 */
const STATUS_CODES: Readonly<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

/** Builds the ApiError envelope; 5xx bodies never carry the internal message. */
export function toApiError(error: FastifyError, status: number): ApiError {
  if (status >= 500) return { error: 'internal_server_error' };
  const field = validationField(error.validation);
  return {
    error: error.code ?? STATUS_CODES[status] ?? 'ERROR',
    ...(error.message && { detail: error.message }),
    ...(field && { field }),
  };
}

/**
 * Registers a global Fastify error handler that:
 * - Never leaks stack traces or internal messages to callers
 * - Logs the full error internally via fastify.log
 * - Returns the ApiError shape for all failures
 *
 * Both handlers here log the URL through `redactUrl`. The `req` serializer in
 * lib/logRedaction.ts only covers the `incoming request` line; anything that
 * logs `request.url` itself has to redact it itself, and the error and
 * not-found paths are reached with a credential still in the query string.
 */
export async function registerErrorHandler(fastify: FastifyInstance): Promise<void> {
  fastify.setErrorHandler<FastifyError>((error, request, reply) => {
    const status = error.statusCode ?? 500;

    // Log full error internally — never surfaces to the client
    fastify.log.error({ err: error, method: request.method, url: redactUrl(request.url) }, 'request error');

    return reply.status(status).send(toApiError(error, status));
  });

  /**
   * Fastify's built-in fallback logs "Route GET:/path?token=… not found" with
   * the raw URL, and echoes the same string back to the caller. A verification
   * link mangled in transit — wrapped by a mail client, truncated — lands here
   * with its token intact, so the default is replaced rather than left in place.
   */
  fastify.setNotFoundHandler((request, reply) => {
    fastify.log.info({ method: request.method, url: redactUrl(request.url) }, 'route not found');

    const body: ApiError = { error: 'not_found', detail: 'route not found' };
    return reply.status(404).send(body);
  });
}
