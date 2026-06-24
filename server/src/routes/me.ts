import type { FastifyInstance } from 'fastify';
import { findUserById } from '../db/queries/users.js';
import { findMembershipsByUserId } from '../db/queries/orgMemberships.js';
import { apiErrorSchema } from '../types/api/common.js';
import type { JwtPayload } from '../plugins/jwt.js';

/** GET /api/v1/me — returns the authenticated user's profile and org memberships. */
export async function registerMeRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/v1/me', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['auth'],
      summary: 'Get the authenticated user profile',
      response: {
        200: {
          type: 'object',
          required: ['user_id', 'email', 'orgs'],
          properties: {
            user_id:      { type: 'string' },
            email:        { type: 'string' },
            display_name: { type: ['string', 'null'] },
            avatar_url:   { type: ['string', 'null'] },
            orgs: {
              type: 'array',
              items: {
                type: 'object',
                required: ['org_id', 'display_name', 'role', 'status', 'email_verified', 'domain_verified'],
                properties: {
                  org_id:          { type: 'string' },
                  display_name:    { type: 'string' },
                  role:            { type: 'string' },
                  status:          { type: 'string', enum: ['pending', 'active', 'suspended'] },
                  email_verified:  { type: 'boolean' },
                  domain_verified: { type: 'boolean' },
                },
              },
            },
          },
        },
        401: apiErrorSchema,
        404: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const jwtUser = request.user as JwtPayload;

    const user = await findUserById(jwtUser.userId);
    if (!user) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: 'user not found' });
    }

    const memberships = await findMembershipsByUserId(user.id);

    return reply.send({
      user_id:      user.id,
      email:        user.email,
      display_name: user.displayName,
      avatar_url:   user.avatarUrl,
      orgs: memberships.map(m => ({
        org_id:          m.orgId,
        display_name:    m.displayName,
        role:            m.role,
        status:          m.status,
        email_verified:  m.emailVerified,
        domain_verified: m.domainVerified,
      })),
    });
  });
}
