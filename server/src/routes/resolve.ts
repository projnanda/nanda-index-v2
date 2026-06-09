import type { FastifyInstance } from 'fastify';
import { apiErrorSchema } from '../types/api/common.js';
import { resolveResponseSchema } from '../types/api/resolve.js';
import { parseLocator } from '../lib/locatorParser.js';
import { resolveAgent, ResolutionError } from '../services/resolution.js';

interface ResolveQuerystring {
  locator: string;
}

/**
 * Agent locator resolution endpoint.
 *
 *   GET /api/v1/resolve?locator=<identifier>@<namespace>:global
 *
 * Looks up the org in the NANDA Index DB → returns IndexRecord (with registry_url)
 * plus the parsed identifier. The caller then fetches the AgentRecord directly:
 *   GET <index_record.registry_url>/agents/<identifier>
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
      parsed = parseLocator(locator);
    } catch (err) {
      return reply.code(400).send({ error: 'invalid_locator', detail: (err as Error).message });
    }

    try {
      const result = await resolveAgent(parsed);
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
