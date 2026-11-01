import { fileURLToPath } from 'url';
import Fastify from 'fastify';
import { buildConfig } from './config/index.js';
import { registerErrorHandler } from './plugins/errorHandler.js';
import { registerHelmet } from './plugins/helmet.js';
import { registerCors } from './plugins/cors.js';
import { registerRateLimit } from './plugins/rateLimit.js';
import { registerDb } from './plugins/db.js';
import { registerAnalytics } from './plugins/analytics.js';
import { registerSwagger } from './plugins/swagger.js';
import { registerCookiePlugin } from './plugins/cookie.js';
import { registerJwtPlugin } from './plugins/jwt.js';
import { registerOAuthPlugin } from './plugins/oauth.js';
import { registerHealthRoute } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAccountVerificationRoutes } from './routes/account-verification.js';
import { registerAccountSettingsRoutes } from './routes/account-settings.js';
import { registerIndexRecordRoutes } from './routes/index-records.js';
import { registerOrgRoutes } from './routes/orgs.js';
import { registerOrgRecoveryRoute } from './routes/org-recovery.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAvailabilityRoute } from './routes/availability.js';
import { registerMeRoute } from './routes/me.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerAgenticSearchRoutes } from './routes/agentic-search.js';
import { registerArdRoutes } from './routes/ard.js';
import { registerResolveRoute } from './routes/resolve.js';

const MAX_BODY_BYTES = 64 * 1024;

export interface BuildServerOptions {
  logger?: boolean;
}

/**
 * Builds and configures the Fastify instance.
 * Exported so integration tests can call buildServer() without binding a port.
 */
export async function buildServer(options: BuildServerOptions = {}) {
  const config = buildConfig();

  const fastify = Fastify({
    // The largest legitimate body is an org create/update: a handful of short
    // strings plus extensions / entry_data / trust_manifest, each capped at
    // 16 KB (lib/jsonLimits.ts). 64 KB leaves headroom for that and rejects
    // anything bigger before it is parsed (Fastify's default is 1 MB).
    bodyLimit: MAX_BODY_BYTES,
    // Behind Caddy, request.ip must be the visitor's address, not the proxy's —
    // otherwise every per-IP rate limit is one bucket shared by all users.
    // Only the configured number of hops is trusted, so a client reaching the
    // API directly cannot pick its own address via X-Forwarded-For.
    ...(config.trustProxyHops > 0 ? { trustProxy: config.trustProxyHops } : {}),
    logger:
      options.logger === false
        ? false
        : { level: config.nodeEnv === 'production' ? 'info' : 'debug' },
  });

  // Error handler first — wraps all subsequent plugin/route errors
  await registerErrorHandler(fastify);
  // Security headers + rate limiting before routes
  await registerHelmet(fastify);
  await registerCors(fastify);
  await registerRateLimit(fastify);
  await registerDb(fastify);
  await registerAnalytics(fastify);
  await registerCookiePlugin(fastify);
  await registerJwtPlugin(fastify);
  await registerOAuthPlugin(fastify);

  // Swagger must register before routes
  await registerSwagger(fastify);

  // Routes
  await registerHealthRoute(fastify);
  await registerAuthRoutes(fastify);
  await registerAccountVerificationRoutes(fastify);
  await registerAccountSettingsRoutes(fastify);
  await registerIndexRecordRoutes(fastify);
  await registerOrgRoutes(fastify);
  await registerOrgRecoveryRoute(fastify);
  await registerAdminRoutes(fastify);
  await registerAvailabilityRoute(fastify);
  await registerMeRoute(fastify);
  await registerSearchRoutes(fastify);
  await registerAgenticSearchRoutes(fastify);
  await registerArdRoutes(fastify);
  await registerResolveRoute(fastify);

  return { fastify, config };
}

async function main(): Promise<void> {
  const { fastify, config } = await buildServer();

  const shutdown = async () => {
    await fastify.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await fastify.listen({ port: config.port, host: '0.0.0.0' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
