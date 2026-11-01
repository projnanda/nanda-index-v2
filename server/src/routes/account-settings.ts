import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { buildConfig } from '../config/index.js';
import { createPasswordHasher, newPasswordError, newPasswordSchema } from '../lib/password.js';
import { findUserById, type User } from '../db/queries/users.js';
import {
  isLoginLocked,
  recordLoginFailure,
  clearLoginFailures,
} from '../db/queries/loginFailures.js';
import {
  AccountSettingsError,
  changeAccountPassword,
  deleteAccount,
  discardDeletionCode,
  issueDeletionCode,
  revokeAccountSessions,
  updateAccountProfile,
} from '../db/queries/accountSettings.js';
import { sendAccountDeletionEmail } from '../services/email.js';
import { apiErrorSchema } from '../types/api/common.js';

const okSchema = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
} as const;
const errorResponses = {
  400: apiErrorSchema,
  401: apiErrorSchema,
  403: apiErrorSchema,
  409: apiErrorSchema,
  429: apiErrorSchema,
};
const currentPasswordSchema = { type: 'string', minLength: 1, maxLength: 128 } as const;

export async function registerAccountSettingsRoutes(app: FastifyInstance): Promise<void> {
  const config = buildConfig();
  const passwords = createPasswordHasher(config.auth.maxConcurrentHashes);
  const options = {
    config: {
      rateLimit: { max: config.auth.rateLimitMax, timeWindow: config.auth.rateLimitWindow },
    },
    preHandler: [app.authenticate],
  };
  const version = (request: FastifyRequest) => request.user.tokenVersion ?? 0;
  async function account(request: FastifyRequest): Promise<User> {
    const user = await findUserById(request.user.userId);
    if (!user || user.tokenVersion !== version(request))
      throw new AccountSettingsError(401, 'UNAUTHORIZED', 'session expired; please sign in again');
    return user;
  }
  async function verifyPassword(
    request: FastifyRequest,
    user: User,
    password: string | undefined,
  ): Promise<void> {
    if (await isLoginLocked(user.email, request.ip))
      throw new AccountSettingsError(
        429,
        'TOO_MANY_ATTEMPTS',
        'too many password attempts; try again later',
      );
    if (!password || !(await passwords.verify(password, user.passwordHash))) {
      await recordLoginFailure(user.email, request.ip, {
        maxAttempts: config.auth.maxLoginAttempts,
        lockoutMinutes: config.auth.lockoutMinutes,
      });
      throw new AccountSettingsError(403, 'INVALID_PASSWORD', 'the current password is incorrect');
    }
    await clearLoginFailures(user.email, request.ip);
  }
  function failure(error: unknown, reply: FastifyReply) {
    if (!(error instanceof AccountSettingsError)) throw error;
    return reply
      .code(error.statusCode)
      .send({
        error: error.code,
        detail: error.message,
        ...(error.organizations && {
          organizations: error.organizations.map((org) => ({
            org_id: org.orgId,
            display_name: org.displayName,
          })),
        }),
      });
  }

  app.patch<{ Body: { display_name: string | null } }>(
    '/api/v1/me',
    {
      ...options,
      schema: {
        tags: ['auth'],
        summary: 'Update your display name',
        body: {
          type: 'object',
          required: ['display_name'],
          additionalProperties: false,
          properties: { display_name: { type: ['string', 'null'], maxLength: 255 } },
        },
        response: {
          ...errorResponses,
          200: {
            type: 'object',
            required: ['token', 'display_name'],
            properties: { token: { type: 'string' }, display_name: { type: ['string', 'null'] } },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const user = await updateAccountProfile(
          request.user.userId,
          version(request),
          request.body.display_name,
        );
        const token = await reply.jwtSign(
          {
            userId: user.id,
            email: user.email,
            displayName: user.displayName,
            tokenVersion: user.tokenVersion,
          },
          { expiresIn: config.jwt.expiresIn },
        );
        return reply.send({ token, display_name: user.displayName });
      } catch (error) {
        return failure(error, reply);
      }
    },
  );

  app.post<{ Body: { current_password: string; new_password: string } }>(
    '/auth/change-password',
    {
      ...options,
      schema: {
        tags: ['auth'],
        summary: 'Change password and revoke every session',
        body: {
          type: 'object',
          required: ['current_password', 'new_password'],
          additionalProperties: false,
          properties: { current_password: currentPasswordSchema, new_password: newPasswordSchema },
        },
        response: { ...errorResponses, 200: okSchema },
      },
    },
    async (request, reply) => {
      try {
        const passwordError = newPasswordError(request.body.new_password);
        if (passwordError)
          throw new AccountSettingsError(400, 'INVALID_PASSWORD', `new_password ${passwordError}`);
        const user = await account(request);
        if (!user.passwordHash)
          throw new AccountSettingsError(
            409,
            'PASSWORD_UNAVAILABLE',
            'this account signs in with an external provider; manage its password there',
          );
        await verifyPassword(request, user, request.body.current_password);
        await changeAccountPassword(
          user.id,
          version(request),
          user.passwordHash,
          await passwords.hash(request.body.new_password),
        );
        return reply.send({ ok: true });
      } catch (error) {
        return failure(error, reply);
      }
    },
  );

  app.post(
    '/auth/logout-all',
    {
      ...options,
      schema: {
        tags: ['auth'],
        summary: 'Sign out every session including this one',
        response: { ...errorResponses, 200: okSchema },
      },
    },
    async (request, reply) => {
      try {
        await revokeAccountSessions(request.user.userId, version(request));
        return reply.send({ ok: true });
      } catch (error) {
        return failure(error, reply);
      }
    },
  );

  app.post(
    '/auth/request-account-deletion',
    {
      ...options,
      schema: {
        tags: ['auth'],
        summary: 'Email a deletion confirmation code for an OAuth account',
        response: { ...errorResponses, 200: okSchema, 503: apiErrorSchema },
      },
    },
    async (request, reply) => {
      try {
        const proof = await issueDeletionCode(request.user.userId, version(request));
        try {
          await sendAccountDeletionEmail(proof.email, proof.code);
        } catch {
          await discardDeletionCode(request.user.userId, proof.code);
          return reply
            .code(503)
            .send({
              error: 'EMAIL_UNAVAILABLE',
              detail: 'could not send the deletion code; please try again later',
            });
        }
        return reply.send({ ok: true });
      } catch (error) {
        return failure(error, reply);
      }
    },
  );

  app.delete<{
    Body: { confirmation: 'DELETE'; current_password?: string; deletion_code?: string };
  }>(
    '/api/v1/me',
    {
      ...options,
      schema: {
        tags: ['auth'],
        summary: 'Delete your account after confirming account control',
        body: {
          type: 'object',
          required: ['confirmation'],
          additionalProperties: false,
          properties: {
            confirmation: { const: 'DELETE' },
            current_password: currentPasswordSchema,
            deletion_code: { type: 'string', maxLength: 128 },
          },
        },
        response: {
          ...errorResponses,
          409: {
            type: 'object',
            required: ['error', 'detail'],
            properties: {
              error: { type: 'string' },
              detail: { type: 'string' },
              organizations: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['org_id', 'display_name'],
                  properties: { org_id: { type: 'string' }, display_name: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const user = await account(request);
        if (user.passwordHash) await verifyPassword(request, user, request.body.current_password);
        await deleteAccount(user.id, version(request), {
          ...(user.passwordHash && { verifiedPasswordHash: user.passwordHash }),
          deletionCode: request.body.deletion_code,
        });
        return reply.code(204).send();
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
}
