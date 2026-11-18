import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fjwt from '@fastify/jwt';
import { buildConfig } from '../config/index.js';
import { findUserById } from '../db/queries/users.js';
import { isSessionRevoked } from '../db/queries/revokedSessions.js';

export interface JwtPayload {
  userId: string;
  email: string;
  displayName: string | null;
  /** users.token_version at issue time. Tokens minted before this claim
   *  existed carry none and are treated as version 0. */
  tokenVersion?: number;
  /** Random id of the sign-in session, kept when a token is re-issued for it
   *  (profile update). Signing out revokes it (POST /auth/logout). Tokens
   *  minted before this claim existed carry none. */
  jti?: string;
  /** Standard claims, set on every signed token. */
  iat?: number;
  exp?: number;
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a session id this server issues (a UUID, see signSession). */
function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value);
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireVerifiedAccount: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Registers @fastify/jwt and adds two preHandler decorators:
 *
 *   fastify.authenticate           — valid, unrevoked session token required
 *   fastify.requireVerifiedAccount — account email must be verified
 *                                    (use after authenticate)
 *
 * Protected routes use: `preHandler: [fastify.authenticate, ...]`
 */
export async function registerJwtPlugin(fastify: FastifyInstance): Promise<void> {
  const config = buildConfig();
  await fastify.register(fjwt, { secret: config.jwt.secret });

  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'UNAUTHORIZED', detail: 'missing or invalid token' });
      return;
    }
    // We only ever issue UUID session ids; anything else is not our token.
    const claims = request.user as JwtPayload;
    if (claims.jti !== undefined && !isSessionId(claims.jti)) {
      reply.code(401).send({ error: 'UNAUTHORIZED', detail: 'missing or invalid token' });
      return;
    }

    // A signature check alone cannot revoke a JWT. Comparing against the
    // user's current token_version lets a password reset end every older
    // session, and a deleted account's tokens stop working immediately.
    // A signed-out session's id is refused as well.
    const { userId, tokenVersion, jti } = claims;
    const user = await findUserById(userId);
    if (!user || user.tokenVersion !== (tokenVersion ?? 0) || (jti && await isSessionRevoked(jti))) {
      reply.code(401).send({ error: 'UNAUTHORIZED', detail: 'session expired; please sign in again' });
    }
  });

  // Looked up fresh rather than read from JWT claims: a session issued before
  // the user clicked the verification link must start working right away.
  fastify.decorate('requireVerifiedAccount', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as JwtPayload;
    const user = await findUserById(userId);
    if (!user?.emailVerified) {
      reply.code(403).send({ error: 'ACCOUNT_NOT_VERIFIED', detail: 'verify your account email first' });
    }
  });
}
