import type { FastifyInstance } from 'fastify';
import oauth2 from '@fastify/oauth2';
import { buildConfig } from '../config/index.js';

// Hardcoded because @fastify/oauth2's TS types don't expose these on the
// default export (only on the FastifyOauth2 interface). Values match runtime output.
const GOOGLE_CONFIGURATION = {
  authorizeHost: 'https://accounts.google.com',
  authorizePath: '/o/oauth2/v2/auth',
  tokenHost:     'https://www.googleapis.com',
  tokenPath:     '/oauth2/v4/token',
};

const GITHUB_CONFIGURATION = {
  tokenHost:     'https://github.com',
  tokenPath:     '/login/oauth/access_token',
  authorizePath: '/login/oauth/authorize',
};

/**
 * Registers @fastify/oauth2 for Google and GitHub.
 * Each provider is only registered when both client ID and secret are set —
 * this allows local dev without OAuth credentials (email/password still works).
 *
 * Decorators added (when configured): fastify.oauth2Google, fastify.oauth2Github
 * Start paths: /auth/google, /auth/github
 * Callbacks: /auth/google/callback, /auth/github/callback
 */
export async function registerOAuthPlugin(fastify: FastifyInstance): Promise<void> {
  const config = buildConfig();

  if (config.oauth.googleClientId && config.oauth.googleClientSecret) {
    await fastify.register(oauth2, {
      name: 'oauth2Google',
      credentials: {
        client: {
          id:     config.oauth.googleClientId,
          secret: config.oauth.googleClientSecret,
        },
        auth: GOOGLE_CONFIGURATION,
      },
      scope: ['profile', 'email'],
      startRedirectPath: '/auth/google',
      callbackUri: `${config.oauth.callbackBaseUrl}/auth/google/callback`,
    });
  }

  if (config.oauth.githubClientId && config.oauth.githubClientSecret) {
    await fastify.register(oauth2, {
      name: 'oauth2Github',
      credentials: {
        client: {
          id:     config.oauth.githubClientId,
          secret: config.oauth.githubClientSecret,
        },
        auth: GITHUB_CONFIGURATION,
      },
      scope: ['user:email'],
      startRedirectPath: '/auth/github',
      callbackUri: `${config.oauth.callbackBaseUrl}/auth/github/callback`,
    });
  }
}
