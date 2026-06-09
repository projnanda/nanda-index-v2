import type { FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';

/**
 * Generates an OpenAPI 3 spec from the JSON schemas already declared on
 * each route, and serves Swagger UI at /docs.
 *
 * MUST be registered before any route whose schema you want documented —
 * @fastify/swagger snapshots schemas at route-registration time.
 *
 *   /docs        → Swagger UI
 *   /docs/json   → OpenAPI JSON (for codegen)
 *   /docs/yaml   → OpenAPI YAML
 */
export async function registerSwagger(fastify: FastifyInstance): Promise<void> {
  await fastify.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'NANDA Index Server',
        description:
          'GARR v2 — NANDA Index Server. Stores IndexRecords pointing to Registry Servers. ' +
          'Registry Servers store AgentRecords with card_url links to A2A cards.',
        version: '2.0.0',
      },
      servers: [{ url: 'http://localhost:3001', description: 'local dev' }],
      tags: [
        { name: 'health',  description: 'Liveness and readiness probes' },
        { name: 'auth',    description: 'OAuth login and email verification' },
        { name: 'index',   description: 'Public index record lookup' },
        { name: 'orgs',    description: 'Authenticated org management' },
        { name: 'search',  description: 'Keyword search' },
        { name: 'resolve', description: '2-hop agent resolution' },
      ],
    },
  });

  await fastify.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      deepLinking: true,
    },
  });
}
