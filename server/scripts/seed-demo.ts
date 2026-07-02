/**
 * Demo seed — inserts one representative NANDA Index record per frontend
 * category so the homepage grid and the detail drawer can be exercised
 * end-to-end. Records use the AI-Catalog shapes from the switchboard paper (§6).
 *
 * Run via:  npm run demo:seed   (sets DEMO_MODE=true and loads .env)
 *
 * Idempotent: deletes the demo org_ids first, then re-inserts and activates
 * them directly (the DNS-TXT ownership gate can't complete on localhost).
 */
import { getSql } from '../src/db/client.js';
import { insertOrganization, type InsertOrgParams } from '../src/db/queries/organizations.js';
import type { TrustManifest } from '../src/types/api/index-record.js';

if (process.env.DEMO_MODE !== 'true') {
  console.error('Refusing to seed: set DEMO_MODE=true (use `npm run demo:seed`).');
  process.exit(1);
}

/** Namespace bare keys under the org.projectnanda.* metadata prefix. */
const pn = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [`org.projectnanda.${k}`, v]));

const ZERO_DIGEST = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Illustrative trust manifest for demo records — mirrors the AI Catalog shape
 * (identity, attestations, provenance, signature). NOT a real Sigstore signature.
 */
function demoTrust(identity: string, identityType: string): TrustManifest {
  return {
    identity,
    identityType,
    attestations: [
      {
        type: 'publisher-identity',
        uri: 'base64:eyJkZW1vIjogdHJ1ZX0=',
        mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
        digest: ZERO_DIGEST,
        size: 13408,
        description: 'Illustrative demo attestation — not a real Sigstore signature.',
      },
    ],
    provenance: [
      { relation: 'derivedFrom', sourceId: 'urn:ai:nanda:demo-seed', signatureRef: ZERO_DIGEST },
    ],
    signature: 'eyJkZW1vIjogInNpZ25hdHVyZSJ9',
    metadata: {},
  };
}

type DemoRecord = Omit<InsertOrgParams, 'verifyToken' | 'verifyTokenExpiresAt'>;

const records: DemoRecord[] = [
  {
    orgId: 'travel26',
    displayName: 'Travel26 Enterprise AI Catalog',
    domain: 'travel26.com',
    contactEmail: 'ai@travel26.com',
    registryUrl: 'https://travel26.com/.well-known/ai-catalog.json',
    identifier: 'urn:ai:domain:travel26.com',
    mediaType: 'application/ai-catalog+json',
    description:
      'Public enterprise AI Catalog for Travel26 — agents, tools, MCP servers, and gateways.',
    tags: ['enterprise', 'ai-catalog', 'travel', 'public-agent-discovery'],
    publisher: { identifier: 'urn:ai:domain:travel26.com', displayName: 'Travel26', identityType: 'dns' },
    catalogMetadata: pn({
      resolutionRole: 'nested-ai-catalog',
      preferredDiscovery: 'ai-catalog',
      nandaIndexRole: 'optional-fallback-entry',
    }),
    entryData: null,
  },
  {
    orgId: 'skyblue-refunds',
    displayName: 'SkyBlue Refunds Agent DNS-AID Pointer',
    domain: 'skyblue.com',
    contactEmail: 'agents@skyblue.com',
    registryUrl: null,
    identifier: 'urn:ai:domain:skyblue.com:agent:refunds',
    mediaType: 'application/vnd.dns-aid+json',
    description:
      "Federated entry pointing to SkyBlue's DNS-AID discovery path for its refunds agent.",
    tags: ['enterprise', 'dns-aid', 'airline', 'refunds', 'gateway'],
    publisher: { identifier: 'urn:ai:domain:skyblue.com', displayName: 'SkyBlue Airlines', identityType: 'dns' },
    catalogMetadata: pn({
      resolutionRole: 'dns-aid-pointer',
      preferredDiscovery: 'dns-aid',
      authoritativeSystem: 'skyblue.com DNS',
      nandaIndexRole: 'federated-pointer',
    }),
    entryData: {
      method: 'dns-aid',
      domain: 'skyblue.com',
      organizationDiscoveryName: '_agents.skyblue.com',
      agentDiscoveryName: 'refunds._agents.skyblue.com',
      serviceHint: 'refunds',
      expectedResult: 'DNS-AID returns a gateway, catalog, or agent-card pointer controlled by skyblue.com',
    },
  },
  {
    orgId: 'moonbakery-orders',
    displayName: 'Moon Bakery Orders Agent',
    domain: 'moonbakery.com',
    contactEmail: 'orders@moonbakery.com',
    registryUrl: 'https://agentcards.list39.org/moonbakery.com/orders.json',
    identifier: 'urn:ai:domain:moonbakery.com:agent:orders',
    mediaType: 'application/a2a-agent-card+json',
    description:
      'Ordering agent for Moon Bakery. Menu lookup, order placement, pickup scheduling, and order status.',
    tags: ['smb', 'bakery', 'orders', 'commerce', 'a2a-agent-card'],
    publisher: { identifier: 'urn:ai:domain:moonbakery.com', displayName: 'Moon Bakery', identityType: 'dns' },
    catalogMetadata: pn({
      resolutionRole: 'smb-agent-card',
      preferredDiscovery: 'nandaindex',
      agentCardHost: 'list39.org',
      'runtime.provider': 'AWS',
      'runtime.url': 'https://moonbakery-orders.aws.example.com',
      'auth.metadata': 'public',
      'auth.execution': 'payment_or_session_token_required',
    }),
    entryData: null,
  },
  {
    orgId: 'john-personal',
    displayName: "John's Personal Agent",
    domain: null,
    contactEmail: 'john@hotmail.com',
    registryUrl: 'https://agentcards.list39.org/personal/john%40hotmail.com/card.json',
    identifier: 'urn:ai:email:john@hotmail.com',
    mediaType: 'application/a2a-agent-card+json',
    description:
      'Personal agent for john@hotmail.com. Public metadata is minimal; private actions require user consent.',
    tags: ['personal-agent', 'individual', 'email-identity', 'a2a-agent-card'],
    publisher: { identifier: 'urn:ai:email:john@hotmail.com', displayName: 'John', identityType: 'email' },
    catalogMetadata: pn({
      resolutionRole: 'personal-agent-card',
      preferredDiscovery: 'nandaindex',
      agentCardHost: 'list39.org',
      'runtime.provider': 'Azure',
      'runtime.url': 'https://john-agent.azure.com',
      'auth.metadata': 'public_minimal',
      'auth.execution': 'user_consent_required',
      nandaIndexRole: 'optional-fallback-entry',
    }),
    entryData: null,
  },
  {
    orgId: 'acme-mcp',
    displayName: 'ACME Weather MCP Server',
    domain: 'acme.dev',
    contactEmail: 'dev@acme.dev',
    registryUrl: 'https://mcp.acme.dev/weather/card.json',
    identifier: 'urn:ai:domain:acme.dev:mcp:weather',
    mediaType: 'application/mcp-server-card+json',
    description: 'MCP server exposing weather tools — current conditions, forecasts, and alerts.',
    tags: ['mcp', 'tools', 'weather'],
    publisher: { identifier: 'urn:ai:domain:acme.dev', displayName: 'ACME Dev', identityType: 'dns' },
    catalogMetadata: pn({ resolutionRole: 'mcp-server-card', preferredDiscovery: 'nandaindex' }),
    entryData: null,
  },
  {
    orgId: 'acme-skill',
    displayName: 'ACME PDF Extractor Skill',
    domain: 'skills.acme.dev',
    contactEmail: 'dev@acme.dev',
    registryUrl: 'https://skills.acme.dev/pdf-extractor.zip',
    identifier: 'urn:ai:domain:acme.dev:skill:pdf-extractor',
    mediaType: 'application/agentskill+zip',
    description: 'Agent skill bundle that extracts structured data from PDF documents.',
    tags: ['skill', 'pdf', 'extraction'],
    publisher: { identifier: 'urn:ai:domain:acme.dev', displayName: 'ACME Dev', identityType: 'dns' },
    catalogMetadata: pn({ resolutionRole: 'agent-skill', preferredDiscovery: 'nandaindex' }),
    entryData: null,
  },
  {
    orgId: 'acme-ard',
    displayName: 'ACME Federated Directory (ARD)',
    domain: 'directory.acme.com',
    contactEmail: 'ops@acme.com',
    registryUrl: 'https://directory.acme.com/ard',
    identifier: 'urn:ai:domain:acme.com',
    mediaType: 'application/ai-registry+json',
    description: 'ARD-compatible discovery endpoint backed by AGNTCY Agent Directory.',
    tags: ['enterprise', 'ard', 'agent-directory'],
    publisher: { identifier: 'urn:ai:domain:acme.com', displayName: 'ACME Corp', identityType: 'dns' },
    catalogMetadata: pn({
      resolutionRole: 'ard-endpoint',
      preferredDiscovery: 'ard',
      nandaIndexRole: 'federated-pointer',
    }),
    entryData: null,
  },
];

async function main(): Promise<void> {
  const sql = getSql();
  const ids = records.map((r) => r.orgId);

  // Idempotent reset of the demo set only.
  await sql`DELETE FROM organizations WHERE org_id IN ${sql(ids)}`;

  const verifyTokenExpiresAt = new Date(Date.now() + 86_400_000);
  for (const r of records) {
    const identity = r.identifier ?? (r.domain ? `urn:ai:domain:${r.domain}` : `urn:ai:org:${r.orgId}`);
    await insertOrganization({
      ...r,
      version: r.version ?? '1.0.0',
      trustManifest: r.trustManifest ?? demoTrust(identity, r.publisher?.identityType ?? 'dns'),
      verifyToken: `seed-${r.orgId}`,
      verifyTokenExpiresAt,
    });

    // Activate directly — bypass the DNS-TXT gate that can't be satisfied locally.
    const hasDomain = r.domain != null;
    await sql`
      UPDATE organizations SET
        status = 'active',
        email_verified = true,
        domain_verified = ${hasDomain},
        domain_verified_at = ${hasDomain ? new Date() : null}
      WHERE org_id = ${r.orgId}
    `;
    console.log(`  ✓ ${r.orgId.padEnd(20)} ${r.mediaType}`);
  }

  console.log(`\nSeeded ${records.length} active demo records.`);
  await sql.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
