import Link from "next/link";
import { externalLinks } from "@/lib/site-data";

// ── Registration flow data ────────────────────────────────────────────────────
// "who" and "resolution" follow the paper's Section 6 (Deployment Contexts and
// Use Cases) as closely as the app's own naming allows: the paper's example
// third-party card host is "list39.org", here it's host39.org, the real product.

const FLOWS: {
  id: string;
  title: string;
  subtitle: string;
  identity: string;
  mediaType: string;
  who: string;
  steps: { label: string; detail: string }[];
  resolution: string;
}[] = [
    {
      id: "enterprise-ai-catalog",
      title: "Enterprise AI Catalog",
      subtitle: "Teams / Orgs",
      identity: "urn:ai:domain:example.com",
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
      id: "dns-aid",
      title: "DNS-AID",
      subtitle: "Enterprise / DNS",
      identity: "urn:ai:domain:skyblue.com:agent:refunds",
      mediaType: "application/vnd.dns-aid+json",
      who: "SkyBlue uses DNS-AID at refunds._agents.skyblue.com. NANDA Index does not replace DNS-AID: it makes the DNS-AID path reachable from the global switchboard.",
      steps: [
        { label: "Publish DNS records", detail: "Add DNS-AID TXT records at _agents.yourdomain.com." },
        { label: "Register org", detail: "Create an org in NANDA Index with your DNS-AID discovery name. NANDA stores a pointer; resolvers query your DNS directly." },
        { label: "Verify & go live", detail: "Confirm your contact email. No catalog server required." },
        { label: "Update via DNS", detail: "Any change to your TXT records is immediately visible to all resolvers." },
      ],
      resolution: "NANDA Index, DNS-AID lookup, SkyBlue gateway or Agent Card, auth, agent.",
    },
    {
      id: "smb-agent-card",
      title: "SMB Agent Card",
      subtitle: "Small Business",
      identity: "urn:ai:domain:moonbakery39.com:agent:orders",
      mediaType: "application/a2a-agent-card+json",
      who: "Moon Bakery owns a domain but runs no enterprise infrastructure. Its runtime, agent card, and domain are with three separate providers, a practical example of permissionless deployment. It needs only a stable identity and a delegated path: no dedicated agent-discovery DNS records, enterprise gateway, or organization-operated catalog endpoint required. NANDA Index becomes the primary discovery entry point.",
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
      identity: "urn:ai:email:john@hotmail.com",
      mediaType: "application/a2a-agent-card+json",
      who: "John has no domain. His runtime is on Azure; his agent card is with a third-party host. No personal controlled domain is required. NANDA Index enables identity-first discovery for individuals, when the underlying account identity is verifiably bound to the resolution record.",
      steps: [
        { label: "Create card", detail: "Build your personal agent card on host39.org." },
        { label: "Register org", detail: "Create an org in NANDA Index with your email address as identity." },
        { label: "Verify & go live", detail: "Confirm your email. Your identity: urn:ai:email:you@example.com." },
        { label: "Update via host39", detail: "Edit your card any time on host39.org. No index update needed." },
      ],
      resolution: "NANDA Index, Agent Card at host39.org, Azure runtime, user consent required for private actions.",
    },
  ];

// ── Resolution stages ──────────────────────────────────────────────────────────
// Names and definitions are the paper's own (Section 5.1, Conceptual Model):
// "Identity → Resolution → Discovery → Invocation". The input/output/api lines
// below each definition are how NANDA Index concretely implements that stage;
// that implementation detail is the app's, not the paper's.

const STAGES = [
  {
    id: "identity",
    label: "Identity",
    definition:
      "a stable identifier, such as a domain-anchored identifier, platform identity, DID, or provider-verified account identity.",
    input: "urn:ai:domain:example.com, urn:ai:domain:skyblue.com:agent:refunds, urn:ai:domain:moonbakery39.com:agent:orders, or urn:ai:email:john@hotmail.com",
  },
  {
    id: "resolution",
    label: "Resolution",
    definition: "selection of an authoritative discovery entry point.",
    detail:
      "The resolver sends the identity to the NANDA Index API. The Index returns an IndexRecord containing a catalog URL, a direct agent card URL, or a DNS-AID pointer, plus a TTL for caching.",
    input: "locator: urn:ai:domain:acme.com:agent:time",
    output: "IndexRecord { registry_url, media_type, identifier, ttl_seconds }",
    api: "GET /api/v1/resolve?locator=…",
  },
  {
    id: "discovery",
    label: "Discovery",
    definition:
      "retrieval or search of capabilities through AI Catalog, ARD, DNS-AID, a gateway, or another native mechanism.",
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
  "A requester starts with an identity (domain, email, or URN)",
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
          This yields Identity, Resolution, Discovery, Invocation. NANDA Index is a concrete
          instantiation of this architecture: a federated index of AI Catalog-formatted resolution
          records that map an identity to the correct next discovery object.
        </p>

        {/* ── Registration ───────────────────────────────────────────────── */}
        <section id="registration" className="scroll-mt-24">
          <h2 className="mt-10 text-lg font-bold text-ink-strong">Registration</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-medium">
            There are four registration paths. These mirror the paper&apos;s four deployment
            contexts: enterprise on AI Catalog, enterprise on DNS-AID, SMB, and individual. Pick
            the path that matches how you host agents.
          </p>
        </section>

        {FLOWS.map((flow) => (
          <section key={flow.id} id={flow.id} className="scroll-mt-24">
            <h3 className="mt-8 font-semibold text-ink-strong">
              {flow.title} ({flow.subtitle})
            </h3>
            <p className="mt-1 text-sm text-ink-medium">
              Identity: <span className="font-mono text-xs">{flow.identity}</span>
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
            Identity, Resolution, Discovery, Invocation
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-medium">
            The paper&apos;s typical flow: a requester starts with an identity, queries a
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
            resolve a live identity
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
