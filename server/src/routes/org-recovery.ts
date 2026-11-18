import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  completeOrgRecovery, discardRecoveryChallenge, INVALID_PROOF_DETAIL, prepareOrgRecovery,
  RecoveryError, recoveryTokenHash,
} from '../db/queries/orgRecovery.js';
import { toIndexRecord } from '../db/queries/organizations.js';
import { findUserById } from '../db/queries/users.js';
import { buildConfig } from '../config/index.js';
import { lookupTxtToken } from '../services/domainVerification.js';
import { sendOrgRecoveryEmail } from '../services/email.js';
import { INDEX_RECORD_SCHEMA } from '../types/api/index-record.js';
import { apiErrorSchema } from '../types/api/common.js';

export async function registerOrgRecoveryRoute(fastify: FastifyInstance): Promise<void> {
  const { claims } = buildConfig();
  // An authenticated account has one budget across orgs and source IPs. The
  // existing per-IP limit still runs before authentication via route config.
  const accountLimit = fastify.createRateLimit({
    max: claims.recoveryRateLimitMax, timeWindow: '1 hour',
    keyGenerator: (request) => `org-recovery:${request.user.userId}`,
  });
  fastify.post<{ Params: { org_id: string }; Body: { token?: string } | undefined }>(
    '/api/v1/orgs/:org_id/claim', {
      preValidation: [
        fastify.authenticate,
        async (request) => { request.body ??= {}; },
      ],
      preHandler: [fastify.requireVerifiedAccount, async (request, reply) => {
        const limit = await accountLimit(request);
        if (!limit.isAllowed && limit.isExceeded) {
          return reply.header('Retry-After', limit.ttlInSeconds).code(429)
            .send({ error: 'RECOVERY_RATE_LIMIT', detail: 'too many recovery requests; try again later' });
        }
      }],
      config: { rateLimit: { max: claims.writeRateLimitMax, timeWindow: claims.writeRateLimitWindow } },
      schema: {
        tags: ['orgs'], summary: 'Recover an orphaned entry using account-bound DNS or email proof',
        params: { type: 'object', required: ['org_id'], properties: { org_id: { type: 'string' } } },
        body: { type: 'object', additionalProperties: false,
          properties: { token: { type: 'string', pattern: '^[a-f0-9]{64}$' } } },
        response: {
          201: INDEX_RECORD_SCHEMA,
          202: { type: 'object', properties: {
            status: { type: 'string' }, method: { type: 'string' }, expires_at: { type: 'string' },
            record_name: { type: 'string' }, record_value: { type: 'string' },
          } },
          400: apiErrorSchema, 401: apiErrorSchema, 403: apiErrorSchema, 404: apiErrorSchema,
          409: apiErrorSchema, 429: apiErrorSchema,
        },
      },
    }, async (request, reply) => {
      try {
        const { userId, tokenVersion = 0 } = request.user;
        const token = request.body?.token;
        const { org, challenge, created, emailToken } = await prepareOrgRecovery(request.params.org_id, userId, !token);
        if (challenge.method === 'email') {
          if (!token) {
            if (emailToken) {
              try {
                const user = await findUserById(userId);
                if (!user) throw new RecoveryError(401, 'UNAUTHORIZED', 'session expired; please sign in again');
                await sendOrgRecoveryEmail(challenge.subject, emailToken, org.orgId, user.email);
              } catch (err) {
                await discardRecoveryChallenge(challenge.id);
                throw err;
              }
            }
            return reply.code(202).send({ status: 'email_sent', method: 'email', expires_at: challenge.expiresAt.toISOString() });
          }
          if (!timingSafeEqual(Buffer.from(recoveryTokenHash(token), 'hex'), Buffer.from(challenge.tokenHash, 'hex'))) {
            return reply.code(400).send({ error: 'INVALID_RECOVERY_PROOF', detail: INVALID_PROOF_DETAIL });
          }
        } else {
          const recordName = `_nanda-recovery.${challenge.subject}`;
          const recordValue = `nanda-recover=${challenge.dnsToken}`;
          if (created) {
            return reply.code(202).send({ status: 'challenge_issued', method: 'dns',
              record_name: recordName, record_value: recordValue, expires_at: challenge.expiresAt.toISOString() });
          }
          const { verified } = await lookupTxtToken(recordName, recordValue);
          if (!verified) return reply.code(400).send({ error: 'DOMAIN_NOT_VERIFIED',
            detail: `publish TXT "${recordValue}" at ${recordName}, then try again` });
        }
        const recovered = await completeOrgRecovery(challenge, userId, tokenVersion);
        request.log.info({ orgId: org.orgId, userId, method: challenge.method }, 'org recovered by ownership proof');
        return reply.code(201).send(toIndexRecord(recovered));
      } catch (err) {
        if (err instanceof RecoveryError) return reply.code(err.statusCode).send({ error: err.code, detail: err.message });
        throw err;
      }
    },
  );
}
