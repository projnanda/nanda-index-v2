import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { SectionHeading } from "@/components/SectionHeading";

// ── Static color maps — full class strings so Tailwind v4 can scan them ──────

type PathId = "registry" | "dns-aid" | "smb" | "personal";

const COLORS: Record<PathId, { accent: string; num: string; badge: string }> = {
  registry: { accent: "bg-indigo-500", num: "bg-indigo-100 text-indigo-700", badge: "bg-indigo-100 text-indigo-700" },
  "dns-aid": { accent: "bg-sky-500", num: "bg-sky-100 text-sky-700", badge: "bg-sky-100 text-sky-700" },
  smb: { accent: "bg-emerald-500", num: "bg-emerald-100 text-emerald-700", badge: "bg-emerald-100 text-emerald-700" },
  personal: { accent: "bg-violet-500", num: "bg-violet-100 text-violet-700", badge: "bg-violet-100 text-violet-700" },
};

// ── Registration flow data ────────────────────────────────────────────────────

const FLOWS: {
  id: PathId;
  title: string;
  subtitle: string;
  identity: string;
  mediaType: string;
  who: string;
  steps: { label: string; detail: string }[];
}[] = [
    {
      id: "registry",
      title: "Enterprise Registry",
      subtitle: "Teams / Orgs",
      identity: "urn:ai:domain:example.com",
      mediaType: "application/ai-catalog+json",
      who: "Enterprises that own their DNS domain. They list agents at .well_known/ai-catalog.json.",
      steps: [
        { label: "Deploy ai-catalog", detail: "Deploy at .well-known, (optionally clone https://github.com/projnanda/nanda-registry-server-repo which provides basic ai-catalog hosting code)" },
        { label: "Register org", detail: "Create an org in NANDA Index with your registry base URL and domain." },
        { label: "Add agents", detail: "Register each agent on your registry via Registry Manager or the /agents API." },
        { label: "Verify & go live", detail: "Confirm your contact email. Resolvers can now discover your agents." },
      ],
    },
    {
      id: "dns-aid",
      title: "DNS-AID",
      subtitle: "Enterprise / DNS",
      identity: "urn:ai:domain:skyblue.com",
      mediaType: "application/vnd.dns-aid+json",
      who: "Enterprises that manage their own DNS. Agent discovery is embedded in DNS TXT records; NANDA Index stores only a federated pointer, not the catalog.",
      steps: [
        { label: "Publish DNS records", detail: "Add DNS-AID TXT records at _agents.yourdomain.com." },
        { label: "Register org", detail: "Create an org in NANDA Index with your DNS-AID discovery name. NANDA stores a pointer; resolvers query your DNS directly." },
        { label: "Verify & go live", detail: "Confirm your contact email. No catalog server required." },
        { label: "Update via DNS", detail: "Any change to your TXT records is immediately visible to all resolvers." },
      ],
    },
    {
      id: "smb",
      title: "SMB Agent Card",
      subtitle: "Small Business",
      identity: "urn:ai:domain:moonbakery39.com:agent:orders",
      mediaType: "application/a2a-agent-card+json",
      who: "Small businesses that own a domain but don't run backend infrastructure. Your agent card is hosted for you on host39.org.",
      steps: [
        { label: "Create card", detail: "Build your A2A Agent Card on host39.org. No server setup required." },
        { label: "Register org", detail: "Create an org in NANDA Index and paste your agent card URL." },
        { label: "Verify & go live", detail: "Confirm your contact email. NANDA Index points resolvers directly to your card." },
        { label: "Update via host39", detail: "Edit your card any time on host39.org. No index update needed." },
      ],
    },
    {
      id: "personal",
      title: "Personal Agent",
      subtitle: "Individual",
      identity: "urn:ai:email:john@hotmail.com",
      mediaType: "application/a2a-agent-card+json",
      who: "Individuals without a domain. Your email address is your agent identity; no domain or server infrastructure needed.",
      steps: [
        { label: "Create card", detail: "Build your personal agent card on host39.org." },
        { label: "Register org", detail: "Create an org in NANDA Index with your email address as identity." },
        { label: "Verify & go live", detail: "Confirm your email. Your identity: urn:ai:email:you@example.com." },
        { label: "Update via host39", detail: "Edit your card any time on host39.org. No index update needed." },
      ],
    },
  ];

// ── Resolution hop data ───────────────────────────────────────────────────────

const HOPS = [
  {
    n: 1,
    label: "NANDA Index",
    subtitle: "Who manages this identity?",
    detail:
      "The resolver sends a locator (a URN, domain name, or email address) to the NANDA Index API. The Index looks up the matching record and returns an IndexRecord containing a catalog URL, a direct agent card URL, or a DNS-AID pointer, plus a TTL for caching.",
    input: "locator: urn:ai:domain:acme.com:agent:time",
    output: "IndexRecord { registry_url, media_type, identifier, ttl_seconds }",
    api: "GET /api/v1/resolve?locator=…",
  },
  {
    n: 2,
    label: "Agent Source",
    subtitle: "What is this specific agent's entry?",
    detail:
      "The resolver fetches the agent's catalog entry from the registry or card URL from Hop 1. Enterprise registries serve an AI Catalog document; SMB and personal entries point directly to an A2A Agent Card. In those cases Hop 2 and Hop 3 collapse into one request.",
    input: "IndexRecord.registry_url  +  IndexRecord.identifier",
    output: "CatalogEntry { url, displayName, mediaType, tags }",
    api: "GET <registry_url>/agents/<identifier>",
  },
  {
    n: 3,
    label: "Agent Card",
    subtitle: "What can this agent do?",
    detail:
      "The resolver fetches the full agent card from the URL in the catalog entry. This document describes the agent's capabilities, authentication requirements, supported skills and protocols, and, critically, the live runtime endpoint for invocation.",
    input: "CatalogEntry.url",
    output: "AgentCard { url, authentication, skills, … }",
    api: "GET <catalog_entry.url>",
  },
  {
    n: 4,
    label: "Talk with Agent",
    subtitle: "Send a task directly.",
    detail:
      "With the runtime endpoint discovered, the client invokes the agent directly. NANDA Index is no longer in the critical path. Subsequent calls can skip Hops 1–3 entirely until the cached TTL expires.",
    input: "AgentCard.url  +  { message: { role, parts } }",
    output: "Task result from agent runtime",
    api: "POST <agent_card.url>/run",
  },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HowItWorksPage() {
  return (
    <PageShell
      eyebrow="Reference"
      title="How it works"
      description="NANDA Index supports four registration paths, each designed for a different operator profile, and a unified four-hop resolution flow that turns any agent identity into a live connection."
    >
      {/* ── Registration flows ───────────────────────────────────────────── */}
      <section className="mb-14">
        <SectionHeading
          eyebrow="Registration"
          title="4 registration paths"
          description="Pick the path that matches how you host agents. Once registered, all paths share the same resolution flow."
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
          title="4-hop resolution flow"
          description="Every agent identity resolves through the same sequence regardless of registration path. Hops 1–3 typically complete in under 100 ms and are cacheable at the TTL set in the index record."
        />

        <div>
          {HOPS.map((hop, i) => (
            <div key={hop.n}>
              <div className="rounded-card border border-line bg-surface-light shadow-card p-5">
                <div className="flex items-start gap-4">
                  {/* Step badge */}
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white text-sm font-bold">
                    {hop.n}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <h3 className="font-semibold text-ink-strong">{hop.label}</h3>
                      <span className="text-xs text-ink-weak">{hop.subtitle}</span>
                    </div>
                    <p className="mt-2 text-sm text-ink-medium leading-relaxed">{hop.detail}</p>

                    <dl className="mt-4 space-y-1.5 border-t border-line pt-3">
                      <div className="flex items-start gap-3 font-mono text-xs">
                        <dt className="w-8 shrink-0 font-semibold text-ink-weak">in</dt>
                        <dd className="text-ink break-all">{hop.input}</dd>
                      </div>
                      <div className="flex items-start gap-3 font-mono text-xs">
                        <dt className="w-8 shrink-0 font-semibold text-ink-weak">out</dt>
                        <dd className="text-ink break-all">{hop.output}</dd>
                      </div>
                      <div className="flex items-start gap-3 font-mono text-xs">
                        <dt className="w-8 shrink-0 font-semibold text-ink-weak">api</dt>
                        <dd className="text-brand-500 break-all">{hop.api}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </div>

              {i < HOPS.length - 1 && (
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
            Resolve a live identity to trace every hop, or register your organization.
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
    </PageShell>
  );
}
