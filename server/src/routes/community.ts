import type { FastifyInstance } from 'fastify';
import { clientNetworkKey } from '../lib/clientNetwork.js';
import { sendCommunityInterestEmail, type CommunityInterest } from '../services/communityEmail.js';

const fields = ['name', 'email', 'organization', 'interest', 'working_groups', 'message', 'website'];

export async function registerCommunityRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: CommunityInterest & { website?: string } }>('/api/v1/community-interest', {
    bodyLimit: 64 * 1024,
    config: { rateLimit: { max: 5, timeWindow: '1 hour', keyGenerator: (request) => clientNetworkKey(request.ip) } },
    schema: {
      tags: ['Community'],
      summary: 'Send a contribution, partnership, or question request to the NandaIndex contact',
      body: {
        type: 'object', additionalProperties: false,
        required: ['name', 'email', 'interest'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 120 },
          email: { type: 'string', format: 'email', maxLength: 254 },
          organization: { type: 'string', maxLength: 160 },
          interest: { type: 'string', enum: ['contribute', 'partner', 'question'] },
          working_groups: { type: 'array', maxItems: 3, uniqueItems: true, items: { type: 'string', enum: ['discovery', 'trust-identity', 'use-cases'] } },
          message: { type: 'string', maxLength: 4000 },
          website: { type: 'string', maxLength: 200 },
        },
      },
    },
    preValidation: async (request, reply) => {
      // Reject extra fields before Fastify's default schema coercion can remove them.
      if (request.body && typeof request.body === 'object'
        && Object.keys(request.body).some((key) => !fields.includes(key))) {
        return reply.code(400).send({ error: 'INVALID_SUBMISSION', detail: 'The request contains an unsupported field.' });
      }
    },
  }, async (request, reply) => {
    const body = request.body;
    if (!body.name.trim() || body.website?.trim()) {
      return reply.code(400).send({ error: 'INVALID_SUBMISSION', detail: 'Please check the form and try again.' });
    }
    try {
      await sendCommunityInterestEmail({
        name: body.name.trim(), email: body.email,
        organization: body.organization?.trim(), interest: body.interest,
        working_groups: body.working_groups, message: body.message?.trim(),
      });
      return reply.code(202).send({ status: 'accepted' });
    } catch {
      request.log.warn('Community contact email could not be sent');
      return reply.code(503).send({ error: 'DELIVERY_UNAVAILABLE', detail: 'Please try again later.' });
    }
  });
}
