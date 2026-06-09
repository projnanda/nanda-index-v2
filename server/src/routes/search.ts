import type { FastifyInstance } from 'fastify';
import { apiErrorSchema } from '../types/api/common.js';
import { searchQuerySchema, searchResponseSchema } from '../types/api/search.js';
import { searchOrgs } from '../services/search.js';

interface SearchQuerystring {
  q: string;
}

/** Keyword search across org_id, domain, and display_name. */
export async function registerSearchRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: SearchQuerystring }>('/api/v1/search', {
    schema: {
      tags: ['search'],
      querystring: searchQuerySchema,
      response: {
        200: searchResponseSchema,
        400: apiErrorSchema,
        422: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const query = request.query.q.trim();

    if (query.length < 2) {
      return reply.code(422).send({
        error: 'query_too_short',
        detail: 'q must be at least 2 non-space characters',
      });
    }

    const result = await searchOrgs(query);
    return reply.code(200).send(result);
  });
}
