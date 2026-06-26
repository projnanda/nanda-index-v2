import { fileURLToPath } from 'url';
import Fastify from 'fastify';
import { buildConfig } from './config/index.js';
import { registerErrorHandler } from './plugins/errorHandler.js';
import { registerHelmet } from './plugins/helmet.js';
import { registerCors } from './plugins/cors.js';
import { registerRateLimit } from './plugins/rateLimit.js';
import { registerDb } from './plugins/db.js';
import { registerSwagger } from './plugins/swagger.js';
import { registerCookiePlugin } from './plugins/cookie.js';
import { registerJwtPlugin } from './plugins/jwt.js';
import { registerOAuthPlugin } from './plugins/oauth.js';
import { registerHealthRoute } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerIndexRecordRoutes } from './routes/index-records.js';
import { registerOrgRoutes } from './routes/orgs.js';
import { registerMeRoute } from './routes/me.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerResolveRoute } from './routes/resolve.js';

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
  await registerCookiePlugin(fastify);
  await registerJwtPlugin(fastify);
  await registerOAuthPlugin(fastify);

  // Swagger must register before routes
  await registerSwagger(fastify);

  // Routes
  await registerHealthRoute(fastify);
  await registerAuthRoutes(fastify);
  await registerIndexRecordRoutes(fastify);
  await registerOrgRoutes(fastify);
  await registerMeRoute(fastify);
  await registerSearchRoutes(fastify);
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
