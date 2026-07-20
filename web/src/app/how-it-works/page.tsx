import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { SectionHeading } from "@/components/SectionHeading";
import { externalLinks } from "@/lib/site-data";

// ── Static color maps — full class strings so Tailwind v4 can scan them ──────

type PathId = "registry" | "dns-aid" | "smb" | "personal";

const COLORS: Record<PathId, { accent: string; num: string; badge: string }> = {
  registry: { accent: "bg-indigo-500", num: "bg-indigo-100 text-indigo-700", badge: "bg-indigo-100 text-indigo-700" },
  "dns-aid": { accent: "bg-sky-500", num: "bg-sky-100 text-sky-700", badge: "bg-sky-100 text-sky-700" },
  smb: { accent: "bg-emerald-500", num: "bg-emerald-100 text-emerald-700", badge: "bg-emerald-100 text-emerald-700" },
  personal: { accent: "bg-violet-500", num: "bg-violet-100 text-violet-700", badge: "bg-violet-100 text-violet-700" },
};

// ── Registration flow data ────────────────────────────────────────────────────
// "who" and "resolution" follow the paper's Section 6 (Deployment Contexts and
// Use Cases) as closely as the app's own naming allows: the paper's example
// third-party card host is "list39.org", here it's host39.org, the real product.

const FLOWS: {
  id: PathId;
  title: string;
  subtitle: string;
  identity: string;
  mediaType: string;
  who: string;
  steps: { label: string; detail: string }[];
  resolution: string;
}[] = [
    {
      id: "registry",
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
      id: "smb",
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
      id: "personal",
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
// "Identity → Resolution → Discovery → Invocation". The dl blocks below each
// definition are how NANDA Index concretely implements that stage; that
// implementation detail is the app's, not the paper's.

const STAGES = [
  {
    n: 1,
    label: "Identity",
    definition:
      "a stable identifier, such as a domain-anchored identifier, platform identity, DID, or provider-verified account identity.",
    input: "urn:ai:domain:example.com, urn:ai:domain:skyblue.com:agent:refunds, urn:ai:domain:moonbakery39.com:agent:orders, or urn:ai:email:john@hotmail.com",
  },
  {
    n: 2,
    label: "Resolution",
    definition: "selection of an authoritative discovery entry point.",
    detail:
      "The resolver sends the identity to the NANDA Index API. The Index returns an IndexRecord containing a catalog URL, a direct agent card URL, or a DNS-AID pointer, plus a TTL for caching.",
    input: "locator: urn:ai:domain:acme.com:agent:time",
    output: "IndexRecord { registry_url, media_type, identifier, ttl_seconds }",
    api: "GET /api/v1/resolve?locator=…",
  },
  {
    n: 3,
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
    n: 4,
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
    <PageShell
      eyebrow="Reference"
      title="How it works"
      description="Federated resolution separates two concerns: Resolution, determining where and how discovery should begin, and Discovery, finding capabilities via mechanisms such as ARD. This yields Identity, Resolution, Discovery, Invocation. NANDA Index is a concrete instantiation of this architecture: a federated index of AI Catalog-formatted resolution records that map an identity to the correct next discovery object."
    >
      {/* ── Registration flows ───────────────────────────────────────────── */}
      <section className="mb-14">
        <SectionHeading
          eyebrow="Registration"
          title="4 registration paths"
          description="These mirror the paper's four deployment contexts: enterprise on AI Catalog, enterprise on DNS-AID, SMB, and individual. Pick the path that matches how you host agents."
        />

        <div className="grid gap-5 sm:grid-cols-2">
          {FLOWS.map((flow) => {
            const c = COLORS[flow.id];
            return (
              <article
                key={flow.id}
                className="rounded-card border border-line bg-surface-light shadow-card overflow-hidden flex flex-col"
              >
                {/* Coloured header */}
                <div className={`${c.accent} px-5 py-4`}>
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-base font-semibold text-white leading-tight">
                      {flow.title}
                    </h3>
                    <span className="text-xs text-white/70">{flow.subtitle}</span>
                  </div>
                  <p className="mt-1 font-mono text-xs text-white/80 break-all">
                    {flow.identity}
                  </p>
                </div>

                {/* Body */}
                <div className="p-5 flex-1 flex flex-col gap-4">
                  <p className="text-sm text-ink-medium leading-relaxed">{flow.who}</p>

                  <ol className="space-y-2.5">
                    {flow.steps.map((step, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold mt-0.5 ${c.num}`}
                        >
                          {i + 1}
                        </span>
                        <p className="text-xs leading-relaxed text-ink">
                          <span className="font-semibold text-ink-strong">{step.label}</span>
                          {": "}
                          {step.detail}
                        </p>
                      </li>
                    ))}
                  </ol>

                  {/* Resolution chain, from the paper's Section 6 */}
                  <p className="text-xs leading-relaxed text-ink-weak">
                    <span className="font-semibold text-ink-medium">Resolution: </span>
                    {flow.resolution}
                  </p>

                  {/* Media type badge */}
                  <div className="mt-auto pt-3 border-t border-line">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-medium ${c.badge}`}
                    >
                      {flow.mediaType}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* ── Resolution flow ──────────────────────────────────────────────── */}
      <section className="mb-10">
        <SectionHeading
          eyebrow="Resolution"
          title="Identity, Resolution, Discovery, Invocation"
          description="The paper's typical flow: a requester starts with an identity, queries a resolution system, gets back AI Catalog-formatted resolution entries, follows the discovery path each entry specifies, then discovery, verification, and invocation proceed."
        />

        <ol className="mb-8 space-y-1.5 text-sm text-ink-medium">
          {RESOLUTION_FLOW_STEPS.map((step, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-ink-weak">{i + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <div>
          {STAGES.map((stage, i) => (
            <div key={stage.n}>
              <div className="rounded-card border border-line bg-surface-light shadow-card p-5">
                <div className="flex items-start gap-4">
                  {/* Step badge */}
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white text-sm font-bold">
                    {stage.n}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-ink-strong">{stage.label}</h3>
                    <p className="mt-1 text-sm text-ink-medium leading-relaxed">{stage.definition}</p>
                    {stage.detail && (
                      <p className="mt-2 text-xs text-ink-weak leading-relaxed">{stage.detail}</p>
                    )}

                    {stage.output && (
                      <dl className="mt-4 space-y-1.5 border-t border-line pt-3">
                        <div className="flex items-start gap-3 font-mono text-xs">
                          <dt className="w-8 shrink-0 font-semibold text-ink-weak">in</dt>
                          <dd className="text-ink break-all">{stage.input}</dd>
                        </div>
                        <div className="flex items-start gap-3 font-mono text-xs">
                          <dt className="w-8 shrink-0 font-semibold text-ink-weak">out</dt>
                          <dd className="text-ink break-all">{stage.output}</dd>
                        </div>
                        <div className="flex items-start gap-3 font-mono text-xs">
                          <dt className="w-8 shrink-0 font-semibold text-ink-weak">api</dt>
                          <dd className="text-brand-500 break-all">{stage.api}</dd>
                        </div>
                      </dl>
                    )}
                    {!stage.output && (
                      <p className="mt-4 border-t border-line pt-3 font-mono text-xs text-ink break-all">
                        {stage.input}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {i < STAGES.length - 1 && (
                <div className="mx-auto h-6 w-px bg-line" />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────── */}
      <div className="rounded-card border border-line bg-surface-light shadow-card p-6 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1">
          <h3 className="font-semibold text-ink-strong">Ready to try it?</h3>
          <p className="mt-1 text-sm text-ink-medium">
            Resolve a live identity to trace every stage, or register your organization.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/resolve"
            className="inline-flex items-center justify-center h-9 rounded-control bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600 transition"
          >
            Try resolve
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center h-9 rounded-control border-2 border-line bg-surface-light px-4 text-sm font-medium text-ink hover:border-line-strong transition"
          >
            Register
          </Link>
        </div>
      </div>

      <p className="mt-6 text-xs text-ink-weak">
        Based on{" "}
        <a
          href={externalLinks.paper}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-600 hover:text-brand-700 transition-colors"
        >
          &ldquo;A Global Switchboard for the Agentic Web&rdquo;
        </a>
        , Section 5 (Federated Resolution Architecture) and Section 6 (Deployment Contexts and Use Cases).
      </p>
    </PageShell>
  );
}
