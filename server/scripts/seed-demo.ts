/**
 * Demo seed — inserts one representative NANDA Index record per frontend
 * category so the homepage grid and the detail drawer can be exercised
 * end-to-end. Records use the AI-Catalog shapes from the switchboard paper (§6, §7.3):
 * urn:air: identifiers and the namespaced `org.projectnanda` extension.
 *
 * Run via:  npm run demo:seed   (sets DEMO_MODE=true and loads .env)
 *
 * Idempotent: deletes the demo org_ids first, then re-inserts and activates
 * them directly (the DNS-TXT ownership gate can't complete on localhost).
 */
import { getSql } from '../src/db/client.js';
import { insertOrganization, type InsertOrgParams } from '../src/db/queries/organizations.js';
import type { TrustManifest } from '../src/types/api/index-record.js';
import { NANDA_EXTENSION, type CatalogExtensions } from '../src/lib/entryProfile.js';

if (process.env.DEMO_MODE !== 'true') {
  console.error('Refusing to seed: set DEMO_MODE=true (use `npm run demo:seed`).');
  process.exit(1);
}

/** Wraps bare keys in the AI Catalog `extensions` namespace NANDA owns. */
const pn = (fields: Record<string, unknown>): CatalogExtensions => ({ [NANDA_EXTENSION]: fields });

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
      { relation: 'derivedFrom', sourceId: 'urn:air:nandaindex.org:seed:demo', signatureRef: ZERO_DIGEST },
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
    identifier: 'urn:air:travel26.com:catalog:root',
    mediaType: 'application/ai-catalog+json',
    description:
      'Public enterprise AI Catalog for Travel26 — agents, tools, MCP servers, and gateways.',
    tags: ['enterprise', 'ai-catalog', 'travel', 'public-agent-discovery'],
    publisher: { identifier: 'travel26.com', displayName: 'Travel26', identityType: 'dns' },
    extensions: pn({
      resolutionRole: 'nested-ai-catalog',
      preferredDiscovery: 'ai-catalog',
      nandaIndexRole: 'optional-fallback-entry',
    }),
    entryData: null,
  },
  {
    orgId: 'skyblue-refunds',
    displayName: 'SkyBlue Refunds Agent',
    domain: 'skyblue.com',
    contactEmail: 'agents@skyblue.com',
    registryUrl: 'https://api.skyblue.com/agents/refunds.json',
    identifier: 'urn:air:skyblue.com:agent:refunds',
    mediaType: 'application/a2a-agent-card+json',
    description: 'Federated AI Catalog entry for SkyBlue Refund Agent',
    tags: ['enterprise', 'airline', 'refunds'],
    publisher: { identifier: 'skyblue.com', displayName: 'SkyBlue Airlines', identityType: 'dns' },
    extensions: pn({
      resolutionRole: 'dns-svcb-pointer',
      preferredDiscovery: 'dns-svcb',
      authoritativeSystem: 'skyblue.com DNS',
      nandaIndexRole: 'federated-pointer',
    }),
    entryData: null,
  },
  {
    orgId: 'moonbakery-orders',
    displayName: 'Moon Bakery Orders Agent',
    domain: 'moonbakery.com',
    contactEmail: 'orders@moonbakery.com',
    registryUrl: 'https://agentcards.host39.org/moonbakery.com/orders.json',
    identifier: 'urn:air:moonbakery.com:agent:orders',
    mediaType: 'application/a2a-agent-card+json',
    description:
      'Ordering agent for Moon Bakery. Supports menu lookup, order placement, pickup scheduling, and order status.',
    tags: ['smb', 'bakery', 'orders', 'commerce', 'a2a-agent-card'],
    publisher: { identifier: 'moonbakery.com', displayName: 'Moon Bakery', identityType: 'dns' },
    extensions: pn({
      resolutionRole: 'smb-agent-card',
      preferredDiscovery: 'nandaindex',
      agentCardHost: 'host39.org',
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
    registryUrl: 'https://agentcards.host39.org/personal/john@hotmail.com/card.json',
    identifier: 'urn:air:host39.org:personal:john-hotmail-com',
    mediaType: 'application/a2a-agent-card+json',
    description:
      'Personal agent associated with john@hotmail.com. Public metadata is minimal; private actions require user consent.',
    tags: ['personal-agent', 'individual', 'email-identity', 'a2a-agent-card'],
    publisher: { identifier: 'host39.org', displayName: 'Host39', identityType: 'dns' },
    extensions: pn({
      resolutionRole: 'personal-agent-card',
      preferredDiscovery: 'nandaindex',
      agentCardHost: 'host39.org',
      subjectAccount: 'john@hotmail.com',
      'runtime.provider': 'Azure',
      'runtime.url': 'https://john-agent.azure.com',
      'auth.metadata': 'public_minimal',
      'auth.execution': 'user_consent_required',
    }),
    entryData: null,
  },
  {
    orgId: 'acme-mcp',
    displayName: 'ACME Weather MCP Server',
    domain: 'acme.dev',
    contactEmail: 'dev@acme.dev',
    registryUrl: 'https://mcp.acme.dev/weather/card.json',
    identifier: 'urn:air:acme.dev:mcp:weather',
    mediaType: 'application/mcp-server-card+json',
    description: 'MCP server exposing weather tools — current conditions, forecasts, and alerts.',
    tags: ['mcp', 'tools', 'weather'],
    publisher: { identifier: 'acme.dev', displayName: 'ACME Dev', identityType: 'dns' },
    extensions: pn({ resolutionRole: 'mcp-server-card', preferredDiscovery: 'nandaindex' }),
    entryData: null,
  },
  {
    orgId: 'acme-skill',
    displayName: 'ACME PDF Extractor Skill',
    domain: 'skills.acme.dev',
    contactEmail: 'dev@acme.dev',
    registryUrl: 'https://skills.acme.dev/pdf-extractor.zip',
    identifier: 'urn:air:skills.acme.dev:skill:pdf-extractor',
    mediaType: 'application/agentskill+zip',
    description: 'Agent skill bundle that extracts structured data from PDF documents.',
    tags: ['skill', 'pdf', 'extraction'],
    publisher: { identifier: 'skills.acme.dev', displayName: 'ACME Dev', identityType: 'dns' },
    extensions: pn({ resolutionRole: 'agent-skill', preferredDiscovery: 'nandaindex' }),
    entryData: null,
  },
  {
    orgId: 'acme-ard',
    displayName: 'ACME Federated Directory',
    domain: 'acme.com',
    contactEmail: 'ops@acme.com',
    registryUrl: 'https://directory.acme.com/ard',
    identifier: 'urn:air:acme.com:registry:ard',
    mediaType: 'application/ai-registry+json',
    description: 'ARD-compatible discovery endpoint backed by AGNTCY Agent Directory.',
    tags: ['enterprise', 'ard', 'agent-directory'],
    publisher: { identifier: 'acme.com', displayName: 'ACME Corp', identityType: 'dns' },
    extensions: pn({
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
    await insertOrganization({
      ...r,
      version: r.version ?? '1.0.0',
      trustManifest: r.trustManifest ?? demoTrust(r.identifier, r.publisher?.identityType ?? 'dns'),
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
