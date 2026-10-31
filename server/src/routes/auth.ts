import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  upsertUser,
  findUserByEmail,
  createUserWithPassword,
  wasJustCreated,
  type User,
} from '../db/queries/users.js';
import {
  isLoginLocked,
  recordLoginFailure,
  clearLoginFailures,
  clearAllLoginFailures,
} from '../db/queries/loginFailures.js';
import {
  createResetToken,
  findValidResetToken,
  completePasswordReset,
  hashResetToken,
} from '../db/queries/passwordResetTokens.js';
import { issueAccountVerifyToken } from '../db/queries/accountVerification.js';
import { sendPasswordResetEmail, sendAccountVerificationEmail } from '../services/email.js';
import { buildConfig } from '../config/index.js';
import { createPasswordHasher, newPasswordError, newPasswordSchema } from '../lib/password.js';
import { apiErrorSchema } from '../types/api/common.js';

const INVALID_CREDENTIALS = { error: 'UNAUTHORIZED', detail: 'invalid email or password' } as const;

/** Signs a session JWT carrying the user's current token_version (see plugins/jwt.ts). */
function signSession(reply: FastifyReply, user: User, expiresIn: string): Promise<string> {
  return reply.jwtSign(
    { userId: user.id, email: user.email, displayName: user.displayName, tokenVersion: user.tokenVersion },
    { expiresIn },
  );
}

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
  verified_email?: boolean;
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
/**
 * The login-page error code for a failed OAuth sign-in. An existing account
 * with the same email (e.g. email/password) is not linked automatically —
 * that would let whoever controls one sign-in method take over the other —
 * so the user is told to sign in the way they registered.
 */
function oauthErrorCode(err: unknown): string {
  return (err as { code?: unknown }).code === '23505' ? 'account_exists' : 'oauth_failed';
}

/**
 * Trusts a Google address only when the userinfo response says, as a real
 * boolean, that Google verified it. A missing, null or malformed flag counts
 * as unverified, so the user must confirm the address with us instead.
 */
export function googleEmailVerified(profile: { verified_email?: unknown }): boolean {
  return profile.verified_email === true;
}

export async function registerAuthRoutes(fastify: FastifyInstance): Promise<void> {
  const config = buildConfig();
  const passwords = createPasswordHasher(config.auth.maxConcurrentHashes);

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
        emailVerified: googleEmailVerified(profile),
      });
      if (wasJustCreated(user)) fastify.analytics.capture('user_signed_up', { method: 'google' });

      const token = await signSession(reply, user, config.jwt.expiresIn);

      return reply.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
    } catch (err) {
      fastify.log.error(err, 'Google OAuth callback error');
      return reply.redirect(`${config.frontendUrl}/login?error=${oauthErrorCode(err)}`);
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
            password:     newPasswordSchema,
            display_name: { type: 'string', maxLength: 255 },
          },
        },
        response: {
          201: jwtResponseSchema,
          400: apiErrorSchema,
          409: apiErrorSchema,
          429: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { email, password, display_name } = request.body;
      const passwordError = newPasswordError(password);
      if (passwordError) {
        return reply.code(400).send({ error: 'INVALID_PASSWORD', detail: `password ${passwordError}` });
      }

      // A 409 here does confirm that an email is registered. That is hard to
      // avoid while sign-up returns a session straight away: it cannot hand
      // out a session for someone else's account, and a fake 201 would break
      // the client. The per-IP rate limit on this route bounds probing, and
      // the dashboard stays locked until the email is verified.
      const existing = await findUserByEmail(email);
      if (existing) {
        return reply.code(409).send({ error: 'CONFLICT', detail: 'email already registered' });
      }

      const passwordHash = await passwords.hash(password);
      const user = await createUserWithPassword(email, passwordHash, display_name ?? null);
      fastify.analytics.capture('user_signed_up', { method: 'email' });

      // The session is returned even though the email is unverified, so the
      // dashboard can show the "verify your email" prompt. Org writes stay
      // blocked (requireVerifiedAccount) until the link is used.
      try {
        const verifyToken = await issueAccountVerifyToken(user.id);
        if (verifyToken) await sendAccountVerificationEmail(user.email, verifyToken);
      } catch (err) {
        // Sign-up still succeeds; the user can resend from the dashboard.
        fastify.log.error(err, 'failed to send account verification email');
      }

      const token = await signSession(reply, user, config.jwt.expiresIn);
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
      const ip = request.ip;

      // Soft lockout per (email, client IP): an attacker's failures lock only
      // the attacker's IP, never the real owner signing in from elsewhere.
      // Checked before the user lookup so known and unknown emails behave alike.
      if (await isLoginLocked(email, ip)) {
        return reply.code(429).send({
          error:  'TOO_MANY_ATTEMPTS',
          detail: 'too many failed sign-in attempts from this network; try again later',
        });
      }

      // Unknown emails and OAuth-only accounts still pay for one compare, so
      // response time does not reveal whether an account exists.
      const user = await findUserByEmail(email);
      const valid = await passwords.verify(password, user?.passwordHash);
      if (!user || !valid) {
        await recordLoginFailure(email, ip, {
          maxAttempts:    config.auth.maxLoginAttempts,
          lockoutMinutes: config.auth.lockoutMinutes,
        });
        return reply.code(401).send(INVALID_CREDENTIALS);
      }

      // Successful login clears this IP's accumulated failures / lock.
      await clearLoginFailures(email, ip);

      const token = await signSession(reply, user, config.jwt.expiresIn);
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

  // Complete a password reset using the emailed token. Bumps the user's
  // token_version, which revokes every session issued before the reset.
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
            password: newPasswordSchema,
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
      const passwordError = newPasswordError(password);
      if (passwordError) {
        return reply.code(400).send({ error: 'INVALID_PASSWORD', detail: `password ${passwordError}` });
      }

      const resetToken = await findValidResetToken(hashResetToken(token));
      if (!resetToken) {
        return reply.code(400).send({ error: 'INVALID_TOKEN', detail: 'reset token is invalid or expired' });
      }

      const passwordHash = await passwords.hash(password);
      const user = await completePasswordReset(hashResetToken(token), passwordHash);
      if (!user) {
        return reply.code(400).send({ error: 'INVALID_TOKEN', detail: 'reset token is invalid or expired' });
      }
      // Clear lockouts from every IP so the user can sign in immediately.
      await clearAllLoginFailures(user.email);

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
      // The synthetic noreply address and any unverified fallback are not
      // proven mailboxes, so those accounts must verify with us first.
      let emailVerified = false;
      const emailsResp = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'NANDA-Index-Server',
        },
      });
      if (emailsResp.ok) {
        const emails = await emailsResp.json() as GitHubEmail[];
        const primary = emails.find(e => e.primary && e.verified);
        const chosen = primary ?? emails[0];
        email = chosen?.email ?? email;
        emailVerified = chosen?.verified === true;
      }

      const user = await upsertUser({
        email,
        displayName: profile.name ?? profile.login,
        avatarUrl:   profile.avatar_url,
        provider:    'github',
        providerId:  String(profile.id),
        emailVerified,
      });
      if (wasJustCreated(user)) fastify.analytics.capture('user_signed_up', { method: 'github' });

      const token = await signSession(reply, user, config.jwt.expiresIn);

      return reply.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
    } catch (err) {
      fastify.log.error(err, 'GitHub OAuth callback error');
      return reply.redirect(`${config.frontendUrl}/login?error=${oauthErrorCode(err)}`);
    }
  });
}
