import type { FastifyInstance } from 'fastify';
import { buildConfig } from '../config/index.js';
import { apiErrorSchema } from '../types/api/common.js';
import {
  ardSearchBodySchema,
  ardSearchResponseSchema,
  ardExploreBodySchema,
  ardExploreResponseSchema,
  ardAgentsQuerySchema,
  ardAgentsResponseSchema,
} from '../types/api/ard.js';
import { agenticSearch } from '../services/agenticSearch.js';
import { maybeFederateOut } from '../services/federation.js';
import { buildDescriptor, agentCandidateToArdResult, organizationToArdResult } from '../services/ardRegistry.js';
import { NANDA_TO_ARD_TYPE } from '../lib/ardMapping.js';
import {
  listOrganizationsPaged,
  countOrgsByMediaType,
  countOrgsByTag,
  type OrgsPageFilter,
} from '../db/queries/organizations.js';

interface ArdSearchBody {
  query: { text: string; filter?: { type?: string[] } };
  pageSize?: number;
}

interface ArdExploreBody {
  resultType: { facets: Array<{ field: 'type' | 'tags' }> };
}

interface ArdAgentsQuerystring {
  filter?: string;
  orderBy?: string;
  pageSize?: number;
  pageToken?: string;
}

function reverseArdType(ardType: string): string[] {
  const matches = Object.entries(NANDA_TO_ARD_TYPE)
    .filter(([, v]) => v === ardType)
    .map(([k]) => k);
  return matches.length > 0 ? matches : [ardType];
}

/** Parses ARD's single-term filter grammar `field:"value"` (v1 supports
 *  exactly one term, not the full EBNF grammar — see plan's Explicitly out
 *  of scope). Unrecognized fields are ignored rather than rejected. */
function parseAgentsFilter(raw: string | undefined): OrgsPageFilter | undefined {
  if (!raw) return undefined;
  const match = /^(\w+):"?([^"]+)"?$/.exec(raw.trim());
  if (!match) return undefined;
  const [, field, value] = match as unknown as [string, string, string];

  if (field === 'tags') return { field: 'tags', values: [value] };
  if (field === 'type') return { field: 'mediaType', values: reverseArdType(value) };
  return undefined;
}

/**
 * ARD (Agentic Resource Discovery)-compliant surface: the registry
 * descriptor plus search/explore/agents endpoints, speaking ARD's own
 * camelCase wire format so any ARD-aware client (including ora.ai) can
 * query nanda-index directly. Reuses the same agenticSearch() pipeline as
 * the NANDA-native /api/v1/agentic-search — this is a wire-format adapter,
 * not a second implementation.
 */
export async function registerArdRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/ard', async (_request, reply) => {
    const config = buildConfig();
    return reply.code(200).send(buildDescriptor(config));
  });

  fastify.post<{ Body: ArdSearchBody }>('/api/ard/search', {
    schema: {
      tags: ['ard'],
      body: ardSearchBodySchema,
      response: { 200: ardSearchResponseSchema, 400: apiErrorSchema },
    },
  }, async (request, reply) => {
    const config = buildConfig();
    const { text, filter } = request.body.query;
    const pageSize = request.body.pageSize ?? 30;

    const searchResult = await agenticSearch(text, { limit: pageSize });
    let candidates = searchResult.candidates;
    if (filter?.type && filter.type.length > 0) {
      candidates = candidates.filter((c) => filter.type!.includes(c.type));
    }

    const federated = await maybeFederateOut(text, candidates, config.federation);
    return reply.code(200).send({
      results: federated.candidates.map(agentCandidateToArdResult),
      referrals: federated.referrals,
      pageToken: null,
    });
  });

  fastify.post<{ Body: ArdExploreBody }>('/api/ard/explore', {
    schema: {
      tags: ['ard'],
      body: ardExploreBodySchema,
      response: { 200: ardExploreResponseSchema, 400: apiErrorSchema },
    },
  }, async (request, reply) => {
    const facets: Record<string, { buckets: Array<{ value: string; count: number }> }> = {};

    for (const { field } of request.body.resultType.facets) {
      if (field === 'type') {
        const raw = await countOrgsByMediaType();
        const merged = new Map<string, number>();
        for (const b of raw) {
          const ardType = NANDA_TO_ARD_TYPE[b.value] ?? b.value;
          merged.set(ardType, (merged.get(ardType) ?? 0) + b.count);
        }
        facets['type'] = {
          buckets: Array.from(merged.entries())
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) => b.count - a.count),
        };
      } else if (field === 'tags') {
        facets['tags'] = { buckets: await countOrgsByTag() };
      }
    }

    return reply.code(200).send({ resultType: 'facets', scope: 'organizations', facets });
  });

  fastify.get<{ Querystring: ArdAgentsQuerystring }>('/api/ard/agents', {
    schema: {
      tags: ['ard'],
      querystring: ardAgentsQuerySchema,
      response: { 200: ardAgentsResponseSchema, 400: apiErrorSchema },
    },
  }, async (request, reply) => {
    const pageSize = request.query.pageSize ?? 20;
    const filter = parseAgentsFilter(request.query.filter);

    const { rows, nextPageToken } = await listOrganizationsPaged(
      pageSize,
      request.query.pageToken ?? null,
      filter,
    );

    return reply.code(200).send({
      items: rows.map(organizationToArdResult),
      pageToken: nextPageToken,
    });
  });
}
