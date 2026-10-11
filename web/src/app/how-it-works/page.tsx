import Link from "next/link";

// ── Registration flow data ────────────────────────────────────────────────────
// "who" and "resolution" follow the paper's Section 6 (Deployment Contexts and
// Use Cases) as closely as the app's own naming allows: the paper's example
// third-party card host is "host39.org", here it's host39.org, the real product.

const FLOWS: {
  id: string;
  title: string;
  subtitle: string;
  identifier: string;
  mediaType: string;
  who: string;
  steps: { label: string; detail: string }[];
  resolution: string;
}[] = [
    {
      id: "enterprise-ai-catalog",
      title: "Enterprise AI Catalog",
      subtitle: "Teams / Orgs",
      identifier: "urn:air:example.com:catalog:root",
      mediaType: "application/ai-catalog+json",
      who: "This is the simple case. An enterprise publishes at .well-known/ai-catalog.json. Any requester can fetch it directly, so direct resolution works and NANDA Index is not required. A NANDA Index entry is optional: useful for federation, fallback, and anti-squatting.",
      steps: [
        { label: "Deploy ai-catalog", detail: "Deploy at .well-known, (optionally clone https://github.com/projnanda/nanda-registry-server-repo which provides basic ai-catalog hosting code)" },
        { label: "Register org", detail: "Create an org in NANDA Index with your registry base URL and domain." },
        { label: "Add agents", detail: "Register each agent on your registry via Registry Manager or the /agents API." },
        { label: "Verify & go live", detail: "Confirm your contact email. Resolvers can now discover your agents." },
      ],
      resolution: "Requester fetches AI Catalog directly, selects agent, tool, MCP server, or gateway, follows artifact URL.",
    },
    {
      id: "dns-svcb",
      title: "DNS-Based Service Discovery",
      subtitle: "Enterprise / DNS",
      identifier: "urn:air:skyblue.com:agent:refunds",
      mediaType: "application/a2a-agent-card+json",
      who: "SkyBlue uses DNS-based service discovery via SVCB (RFC 9460). NANDA Index makes this DNS-based discovery path reachable from the global switchboard while representing the target using a recognized A2A Agent Card type.",
      steps: [
        { label: "Publish DNS records", detail: "Publish SVCB/HTTPS records (or DNS-SD, RFC 6763) for your agent's endpoint under your domain." },
        { label: "Register org", detail: "Create an org in NANDA Index with your A2A Agent Card URL. NANDA stores a federated pointer; your DNS stays authoritative." },
        { label: "Verify & go live", detail: "Prove domain ownership with a DNS TXT record. No catalog server required." },
        { label: "Update via DNS", detail: "Any change to your SVCB records is immediately visible to all resolvers." },
      ],
      resolution: "NANDA Index, DNS SVCB lookup, A2A Agent Card, auth, agent.",
    },
    {
      id: "smb-agent-card",
      title: "SMB Agent Card",
      subtitle: "Small Business",
      identifier: "urn:air:moonbakery.com:agent:orders",
      mediaType: "application/a2a-agent-card+json",
      who: "Moon Bakery owns a domain but runs no enterprise infrastructure. Its runtime, agent card, and domain are with three separate providers, a practical example of permissionless deployment. It needs only a stable resource identifier and a delegated path: no dedicated agent-discovery DNS records, enterprise gateway, or organization-operated catalog endpoint required. NANDA Index becomes the primary discovery entry point.",
      steps: [
        { label: "Create card", detail: "Build your A2A Agent Card on host39.org. No server setup required." },
        { label: "Register org", detail: "Create an org in NANDA Index and paste your agent card URL." },
        { label: "Verify & go live", detail: "Confirm your contact email. NANDA Index points resolvers directly to your card." },
        { label: "Update via host39", detail: "Edit your card any time on host39.org. No index update needed." },
      ],
      resolution: "NANDA Index, Agent Card at host39.org, AWS runtime, payment or session token required.",
    },
    {
      id: "personal-agent",
      title: "Personal Agent",
      subtitle: "Individual",
      identifier: "urn:air:host39.org:personal:john@hotmail.com",
      mediaType: "application/a2a-agent-card+json",
      who: "John has no domain. His runtime is on Azure; his agent card is with a third-party host. No personal controlled domain is required. The AIR identifier is anchored to the card host (host39.org) and the account email is carried as subjectAccount. NANDA Index enables identity-first discovery for individuals, when the underlying account identity is verifiably bound to the resolution record.",
      steps: [
        { label: "Create card", detail: "Build your personal agent card on host39.org." },
        { label: "Register org", detail: "Create an org in NANDA Index with your email address as the subject account." },
        { label: "Verify & go live", detail: "Confirm your email. Your identifier: urn:air:host39.org:personal:you@example.com." },
        { label: "Update via host39", detail: "Edit your card any time on host39.org. No index update needed." },
      ],
      resolution: "NANDA Index, Agent Card at host39.org, Azure runtime, user consent required for private actions.",
    },
  ];

// ── Resolution stages ──────────────────────────────────────────────────────────
// Names and definitions are the paper's own (Section 5.1, Conceptual Model):
// "Resource Identifier → Resolution → Discovery → Invocation". The input/output/api lines
// below each definition are how NANDA Index concretely implements that stage;
// that implementation detail is the app's, not the paper's.

const STAGES = [
  {
    id: "identifier",
    label: "Resource Identifier / Lookup Key",
    definition:
      "a stable identifier used to initiate resolution, such as a domain, DID, or provider-verified account identifier. As an AI Catalog/ARD entry identifier it uses the domain-anchored form urn:air:<publisher-FQDN>:<namespace...>:<short-name>.",
    input: "urn:air:example.com:catalog:root, urn:air:skyblue.com:agent:refunds, urn:air:moonbakery.com:agent:orders, or urn:air:host39.org:personal:john@hotmail.com",
  },
  {
    id: "resolution",
    label: "Resolution",
    definition: "selection of an authoritative discovery entry point.",
    detail:
      "The resolver sends the identifier to the NANDA Index API. An exact match returns that entry (a catalog, an agent card, or a DNS SVCB pointer); otherwise, if the publisher fronts its resources with an AI Catalog, that catalog entry is returned (match: publisher) for the requester to look inside. Each record carries a TTL for caching.",
    input: "locator: urn:air:acme.com:agent:time",
    output: "{ match, identifier, index_record { identifier, registry_url, media_type, publisher, extensions, ttl_seconds } }",
    api: "GET /api/v1/resolve?locator=…",
  },
  {
    id: "discovery",
    label: "Discovery",
    definition:
      "retrieval or search of capabilities through AI Catalog, ARD, DNS-based service discovery, a gateway, or another native mechanism.",
    detail:
      "The resolver fetches the agent's catalog entry, then the full agent card, from the URL returned by Resolution. Enterprise registries serve an AI Catalog document; SMB and personal entries point directly to an A2A Agent Card, collapsing these into one request.",
    input: "IndexRecord.registry_url  +  IndexRecord.identifier",
    output: "AgentCard { url, authentication, skills, … }",
    api: "GET <registry_url>/agents/<identifier>, then GET <catalog_entry.url>",
  },
  {
    id: "invocation",
    label: "Invocation",
    definition: "interaction with the selected resource through A2A, MCP, REST, or another supported protocol.",
    detail:
      "With the runtime endpoint discovered, the client invokes the agent directly through A2A. NANDA Index is no longer in the critical path.",
    input: "AgentCard.url  +  { message: { role, parts } }",
    output: "Result from the agent runtime",
    api: "POST <agent_card.url>/run",
  },
];

const RESOLUTION_FLOW_STEPS = [
  "A requester starts with a lookup key or subject identity (for example, a domain, email address, DID, or AIR URN)",
  "The requester queries a resolution system",
  "The system returns AI Catalog–formatted resolution entries",
  "Each entry specifies a discovery path",
  "The requester follows that path (ARD, DNS lookup, gateway, etc.)",
  "Standard discovery, verification, and invocation proceed",
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HowItWorksPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div>
        <h1 className="text-2xl font-bold text-ink-strong">How it works</h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-medium">
          Federated resolution separates two concerns: Resolution, determining where and how
          discovery should begin, and Discovery, finding capabilities via mechanisms such as ARD.
          This yields Resource Identifier, Resolution, Discovery, Invocation. NANDA Index is a
          concrete instantiation of this architecture: a federated index of AI Catalog-formatted
          resolution records that map a resource identifier to the correct next discovery object.
        </p>

        {/* ── Registration ───────────────────────────────────────────────── */}
        <section id="registration" className="scroll-mt-24">
          <h2 className="mt-10 text-lg font-bold text-ink-strong">Registration</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-medium">
            There are four registration paths. These mirror the paper&apos;s four deployment
            contexts: enterprise on AI Catalog, enterprise on DNS-based service discovery, SMB, and
            individual. Pick
            the path that matches how you host agents.
          </p>
        </section>

        {FLOWS.map((flow) => (
          <section key={flow.id} id={flow.id} className="scroll-mt-24">
            <h3 className="mt-8 font-semibold text-ink-strong">
              {flow.title} ({flow.subtitle})
            </h3>
            <p className="mt-1 text-sm text-ink-medium">
              Identifier: <span className="font-mono text-xs">{flow.identifier}</span>
              <br />
              Media type: <span className="font-mono text-xs">{flow.mediaType}</span>
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ink-medium">{flow.who}</p>
            <ol className="mt-3 list-decimal space-y-1.5 pl-6 text-sm leading-relaxed text-ink-medium">
              {flow.steps.map((step) => (
                <li key={step.label}>
                  <span className="font-semibold text-ink-strong">{step.label}</span>
                  {": "}
                  {step.detail}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-sm leading-relaxed text-ink-medium">
              Resolution: {flow.resolution}
            </p>
          </section>
        ))}

        {/* ── Resolution flow ────────────────────────────────────────────── */}
        <section id="resolution-flow" className="scroll-mt-24">
          <h2 className="mt-10 text-lg font-bold text-ink-strong">
            Resource Identifier, Resolution, Discovery, Invocation
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-medium">
            The paper&apos;s typical flow: a requester starts with a resource identifier, queries a
            resolution system, gets back AI Catalog-formatted resolution entries, follows the
            discovery path each entry specifies, then discovery, verification, and invocation
            proceed.
          </p>
          <ol className="mt-3 list-decimal space-y-1.5 pl-6 text-sm leading-relaxed text-ink-medium">
            {RESOLUTION_FLOW_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        {STAGES.map((stage) => (
          <section key={stage.id} id={stage.id} className="scroll-mt-24">
            <h3 className="mt-8 font-semibold text-ink-strong">{stage.label}</h3>
            <p className="mt-1 text-sm leading-relaxed text-ink-medium">{stage.definition}</p>
            {stage.detail && (
              <p className="mt-2 text-sm leading-relaxed text-ink-medium">{stage.detail}</p>
            )}
            <p className="mt-2 font-mono text-xs leading-relaxed text-ink-medium break-all">
              Input: {stage.input}
              {stage.output && (
                <>
                  <br />
                  Output: {stage.output}
                  <br />
                  API: {stage.api}
                </>
              )}
            </p>
          </section>
        ))}

        {/* ── Closing ────────────────────────────────────────────────────── */}
        <p className="mt-10 text-sm leading-relaxed text-ink-medium">
          To try it,{" "}
          <Link href="/resolve" className="underline hover:text-ink-strong transition-colors">
            resolve a live identifier
          </Link>{" "}
          to trace every stage, or{" "}
          <Link href="/login" className="underline hover:text-ink-strong transition-colors">
            register your organization
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
