import type { FastifyInstance } from 'fastify';
import { apiErrorSchema } from '../types/api/common.js';
import { resolveResponseSchema } from '../types/api/resolve.js';
import { parseAirUrn } from '../lib/airUrn.js';
import { resolveIdentifier, ResolutionError } from '../services/resolution.js';

interface ResolveQuerystring {
  locator: string;
}

/**
 * Resolution endpoint — maps a resource identifier to its discovery entry point.
 *
 *   GET /api/v1/resolve?locator=urn:air:moonbakery.com:agent:orders
 *
 * Returns the matching IndexRecord. On match "exact" the record's
 * registry_url is the next hop itself (agent card, catalog, …); on match
 * "publisher" it is the publisher's catalog, and the caller looks up
 * <identifier> (the locator's short-name) inside it.
 */
export async function registerResolveRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: ResolveQuerystring }>('/api/v1/resolve', {
    schema: {
      tags: ['resolve'],
      querystring: {
        type: 'object',
        required: ['locator'],
        additionalProperties: false,
        properties: {
          locator: { type: 'string', minLength: 1 },
        },
      },
      response: {
        200: resolveResponseSchema,
        400: apiErrorSchema,
        404: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const { locator } = request.query;

    let parsed;
    try {
      parsed = parseAirUrn(locator);
    } catch (err) {
      return reply.code(400).send({ error: 'invalid_locator', detail: (err as Error).message });
    }

    try {
      const result = await resolveIdentifier(parsed);
      return reply.code(200).send(result);
    } catch (err) {
      if (!(err instanceof ResolutionError)) throw err;

      const statusMap: Record<ResolutionError['code'], number> = {
        not_found:   404,
        bad_request: 400,
      };

      return reply.code(statusMap[err.code]).send({ error: err.code, detail: err.message });
    }
  });
}
