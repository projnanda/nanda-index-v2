import type { FastifyInstance } from 'fastify';
import { apiErrorSchema } from '../types/api/common.js';
import { agenticSearchQuerySchema, agenticSearchResponseSchema } from '../types/api/agentic-search.js';
import { agenticSearch } from '../services/agenticSearch.js';

interface AgenticSearchQuerystring {
  q: string;
  limit?: number;
}

/**
 * Natural-language task search: ranks candidate orgs locally, fans out live
 * to expand them into agent-level candidates, and returns a merged, scored
 * list — "help me with a task" in, a shortlist of runnable agents out.
 */
export async function registerAgenticSearchRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: AgenticSearchQuerystring }>('/api/v1/agentic-search', {
    schema: {
      tags: ['search'],
      querystring: agenticSearchQuerySchema,
      response: {
        200: agenticSearchResponseSchema,
        400: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const query = request.query.q.trim();
    const result = await agenticSearch(query, { limit: request.query.limit });
    return reply.code(200).send(result);
  });
}
