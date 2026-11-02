import type { FastifyInstance } from 'fastify';
import { findUserById } from '../db/queries/users.js';
import {
  issueAccountVerifyToken,
  consumeAccountVerifyToken,
} from '../db/queries/accountVerification.js';
import { sendAccountVerificationEmail } from '../services/email.js';
import { buildConfig } from '../config/index.js';
import { apiErrorSchema } from '../types/api/common.js';
import type { JwtPayload } from '../plugins/jwt.js';

/**
 * Account email verification.
 *
 *   POST /auth/verify-account               — consume an emailed token (no auth:
 *                                             the link may open in another browser)
 *   POST /auth/resend-account-verification  — email a fresh link (authenticated,
 *                                             60s cooldown per account)
 *
 * Until an account is verified, fastify.requireVerifiedAccount blocks every
 * org write, so unverified accounts cannot get agents listed.
 */
export async function registerAccountVerificationRoutes(fastify: FastifyInstance): Promise<void> {
  const config = buildConfig();

  // Same per-IP throttle as the other auth mutations (opt-in rate limiting).
  const authRateLimit = {
    rateLimit: {
      max: config.auth.rateLimitMax,
      timeWindow: config.auth.rateLimitWindow,
    },
  };

  fastify.post<{ Body: { token: string } }>('/auth/verify-account', {
    config: authRateLimit,
    schema: {
      tags: ['auth'],
      summary: 'Verify the account email using the emailed token',
      body: {
        type: 'object',
        required: ['token'],
        additionalProperties: false,
        properties: {
          token: { type: 'string', minLength: 1, maxLength: 256 },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['ok'],
          properties: { ok: { type: 'boolean' } },
        },
        400: apiErrorSchema,
        429: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const user = await consumeAccountVerifyToken(request.body.token);
    if (!user) {
      return reply.code(400).send({
        error: 'INVALID_TOKEN',
        detail: 'verification link is invalid or expired; request a new one from your dashboard',
      });
    }
    fastify.analytics.capture('account_verified');
    return reply.send({ ok: true });
  });

  fastify.post('/auth/resend-account-verification', {
    config: authRateLimit,
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['auth'],
      summary: 'Send a new account verification email',
      response: {
        200: {
          type: 'object',
          required: ['ok'],
          properties: {
            ok:               { type: 'boolean' },
            already_verified: { type: 'boolean' },
          },
        },
        401: apiErrorSchema,
        429: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const { userId } = request.user as JwtPayload;
    const user = await findUserById(userId);
    if (!user) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', detail: 'session expired; please sign in again' });
    }
    if (user.emailVerified) {
      return reply.send({ ok: true, already_verified: true });
    }

    const issued = await issueAccountVerifyToken(user.id);
    if (!issued) {
      return reply.code(429).send({
        error: 'RESEND_COOLDOWN',
        detail: 'a verification email was sent recently; please wait a minute before requesting another',
      });
    }

    // The address the token is bound to, not user.email read above: an OAuth
    // sign-in may have changed the email in between.
    await sendAccountVerificationEmail(issued.email, issued.token);
    return reply.send({ ok: true });
  });
}
