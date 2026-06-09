import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { upsertUser, findUserByEmail, createUserWithPassword } from '../db/queries/users.js';
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
      schema: {
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: {
            email:    { type: 'string', format: 'email', maxLength: 255 },
            password: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
        response: {
          200: jwtResponseSchema,
          401: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      const user = await findUserByEmail(email);
      if (!user || !user.passwordHash) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', detail: 'invalid email or password' });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', detail: 'invalid email or password' });
      }

      const token = await reply.jwtSign(
        { userId: user.id, email: user.email, displayName: user.displayName },
        { expiresIn: config.jwt.expiresIn },
      );

      return reply.code(200).send({ token });
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
