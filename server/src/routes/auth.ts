import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import {
  upsertUser,
  findUserByEmail,
  createUserWithPassword,
  recordFailedLogin,
  clearLoginFailures,
  updateUserPassword,
} from '../db/queries/users.js';
import {
  createResetToken,
  findValidResetToken,
  markResetTokenUsed,
  hashResetToken,
} from '../db/queries/passwordResetTokens.js';
import { sendPasswordResetEmail } from '../services/email.js';
import { buildConfig } from '../config/index.js';
import { apiErrorSchema } from '../types/api/common.js';

const BCRYPT_ROUNDS = 10;

const jwtResponseSchema = {
  type: 'object',
  required: ['token'],
  properties: {
    token: { type: 'string' },
  },
} as const;

interface GoogleUserInfo {
  id: string;
  email: string;
  name?: string;
  picture?: string;
}

interface GitHubUserInfo {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/**
 * OAuth callback routes for Google and GitHub.
 * Both follow the same pattern:
 *   1. Exchange code for access token via @fastify/oauth2
 *   2. Fetch user profile from provider API
 *   3. Upsert user in DB
 *   4. Sign JWT and redirect to frontend /auth/callback?token=<jwt>
 *
 * Decorator names: fastify.oauth2Google, fastify.oauth2Github
 * (matches the `oauth2X` template literal type from @fastify/oauth2)
 */
export async function registerAuthRoutes(fastify: FastifyInstance): Promise<void> {
  const config = buildConfig();

  // Per-route throttle for auth mutations (login/register/forgot/reset).
  // The rate-limit plugin runs in opt-in mode (global: false), so only routes
  // carrying this config are limited — public read endpoints stay open.
  const authRateLimit = {
    rateLimit: {
      max: config.auth.rateLimitMax,
      timeWindow: config.auth.rateLimitWindow,
    },
  };

  const okSchema = {
    type: 'object',
    required: ['ok'],
    properties: { ok: { type: 'boolean' } },
  } as const;

  // GET /auth/providers — tells the frontend which OAuth providers are active.
  // Frontend uses this to show/hide Google and GitHub buttons.
  fastify.get('/auth/providers', {
    schema: {
      tags: ['auth'],
      summary: 'List configured OAuth providers',
      response: {
        200: {
          type: 'object',
          properties: {
            google: { type: 'boolean' },
            github: { type: 'boolean' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    return reply.send({
      google: !!(config.oauth.googleClientId && config.oauth.googleClientSecret),
      github: !!(config.oauth.githubClientId && config.oauth.githubClientSecret),
    });
  });

  // Google OAuth callback
  fastify.get('/auth/google/callback', async (request, reply) => {
    if (!fastify.oauth2Google) {
      return reply.redirect(`${config.frontendUrl}/login?error=oauth_not_configured`);
    }
    try {
      const tokenData = await fastify.oauth2Google.getAccessTokenFromAuthorizationCodeFlow(request);
      const accessToken = tokenData.token.access_token as string;

      const profileResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!profileResp.ok) {
        return reply.redirect(`${config.frontendUrl}/login?error=profile_fetch_failed`);
      }
      const profile = await profileResp.json() as GoogleUserInfo;

      const user = await upsertUser({
        email:       profile.email,
        displayName: profile.name ?? null,
        avatarUrl:   profile.picture ?? null,
        provider:    'google',
        providerId:  profile.id,
      });

      const token = await reply.jwtSign(
        { userId: user.id, email: user.email, displayName: user.displayName },
        { expiresIn: config.jwt.expiresIn },
      );

      return reply.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
    } catch (err) {
      fastify.log.error(err, 'Google OAuth callback error');
      return reply.redirect(`${config.frontendUrl}/login?error=oauth_failed`);
    }
  });

  // Email/password registration
  fastify.post<{ Body: { email: string; password: string; display_name?: string } }>(
    '/auth/register',
    {
      config: authRateLimit,
      schema: {
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: {
            email:        { type: 'string', format: 'email', maxLength: 255 },
            password:     { type: 'string', minLength: 8, maxLength: 128 },
            display_name: { type: 'string', maxLength: 255 },
          },
        },
        response: {
          201: jwtResponseSchema,
          409: apiErrorSchema,
          429: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { email, password, display_name } = request.body;

      const existing = await findUserByEmail(email);
      if (existing) {
        return reply.code(409).send({ error: 'CONFLICT', detail: 'email already registered' });
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const user = await createUserWithPassword(email, passwordHash, display_name ?? null);

      const token = await reply.jwtSign(
        { userId: user.id, email: user.email, displayName: user.displayName },
        { expiresIn: config.jwt.expiresIn },
      );

      return reply.code(201).send({ token });
    },
  );

  // Email/password login
  fastify.post<{ Body: { email: string; password: string } }>(
    '/auth/login',
    {
      config: authRateLimit,
      schema: {
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: {
            email:    { type: 'string', format: 'email', maxLength: 255 },
            password: { type: 'string', minLength: 8, maxLength: 128 },
          },
        },
        response: {
          200: jwtResponseSchema,
          401: apiErrorSchema,
          429: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      const user = await findUserByEmail(email);
      if (!user || !user.passwordHash) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', detail: 'invalid email or password' });
      }

      // Soft lockout: reject while an active lock window is in effect.
      if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        return reply.code(429).send({
          error:  'TOO_MANY_ATTEMPTS',
          detail: 'account temporarily locked due to repeated failed logins; try again later',
        });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        await recordFailedLogin(user.id, config.auth.maxLoginAttempts, config.auth.lockoutMinutes);
        return reply.code(401).send({ error: 'UNAUTHORIZED', detail: 'invalid email or password' });
      }

      // Successful login clears any accumulated failures / lock.
      await clearLoginFailures(user.id);

      const token = await reply.jwtSign(
        { userId: user.id, email: user.email, displayName: user.displayName },
        { expiresIn: config.jwt.expiresIn },
      );

      return reply.code(200).send({ token });
    },
  );

  // Request a password reset link.
  // Always returns 200 with no body details so the response cannot be used to
  // enumerate which emails are registered.
  fastify.post<{ Body: { email: string } }>(
    '/auth/forgot-password',
    {
      config: authRateLimit,
      schema: {
        tags: ['auth'],
        summary: 'Request a password reset email',
        body: {
          type: 'object',
          required: ['email'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', format: 'email', maxLength: 255 },
          },
        },
        response: {
          200: okSchema,
          429: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { email } = request.body;
      const user = await findUserByEmail(email);

      // Only email/password accounts can reset. OAuth-only users (no
      // password_hash) and unknown emails are silently ignored.
      if (user && user.passwordHash) {
        try {
          const { token } = await createResetToken(user.id, config.auth.resetTokenTtlMinutes);
          await sendPasswordResetEmail(user.email, token);
        } catch (err) {
          fastify.log.error(err, 'failed to issue password reset');
        }
      }

      return reply.code(200).send({ ok: true });
    },
  );

  // Complete a password reset using the emailed token.
  // Note: JWTs are stateless, so any already-issued session token stays valid
  // until it expires — full session revocation is a later-phase concern.
  fastify.post<{ Body: { token: string; password: string } }>(
    '/auth/reset-password',
    {
      config: authRateLimit,
      schema: {
        tags: ['auth'],
        summary: 'Set a new password using a reset token',
        body: {
          type: 'object',
          required: ['token', 'password'],
          additionalProperties: false,
          properties: {
            token:    { type: 'string', minLength: 1, maxLength: 256 },
            password: { type: 'string', minLength: 8, maxLength: 128 },
          },
        },
        response: {
          200: okSchema,
          400: apiErrorSchema,
          429: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { token, password } = request.body;

      const resetToken = await findValidResetToken(hashResetToken(token));
      if (!resetToken) {
        return reply.code(400).send({ error: 'INVALID_TOKEN', detail: 'reset token is invalid or expired' });
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      await updateUserPassword(resetToken.userId, passwordHash);
      await markResetTokenUsed(resetToken.id);
      // Clear any lockout so the user can sign in immediately with the new password.
      await clearLoginFailures(resetToken.userId);

      return reply.code(200).send({ ok: true });
    },
  );

  // GitHub OAuth callback
  fastify.get('/auth/github/callback', async (request, reply) => {
    if (!fastify.oauth2Github) {
      return reply.redirect(`${config.frontendUrl}/login?error=oauth_not_configured`);
    }
    try {
      const tokenData = await fastify.oauth2Github.getAccessTokenFromAuthorizationCodeFlow(request);
      const accessToken = tokenData.token.access_token as string;

      const profileResp = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'NANDA-Index-Server',
        },
      });
      if (!profileResp.ok) {
        return reply.redirect(`${config.frontendUrl}/login?error=profile_fetch_failed`);
      }
      const profile = await profileResp.json() as GitHubUserInfo;

      // Fetch primary verified email (profile.email may be null for private accounts)
      let email = `${profile.login}@github.noreply`;
      const emailsResp = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'NANDA-Index-Server',
        },
      });
      if (emailsResp.ok) {
        const emails = await emailsResp.json() as GitHubEmail[];
        const primary = emails.find(e => e.primary && e.verified);
        email = primary?.email ?? emails[0]?.email ?? email;
      }

      const user = await upsertUser({
        email,
        displayName: profile.name ?? profile.login,
        avatarUrl:   profile.avatar_url,
        provider:    'github',
        providerId:  String(profile.id),
      });

      const token = await reply.jwtSign(
        { userId: user.id, email: user.email, displayName: user.displayName },
        { expiresIn: config.jwt.expiresIn },
      );

      return reply.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
    } catch (err) {
      fastify.log.error(err, 'GitHub OAuth callback error');
      return reply.redirect(`${config.frontendUrl}/login?error=oauth_failed`);
    }
  });
}
