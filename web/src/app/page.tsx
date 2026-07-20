import Link from "next/link";
import { Hero } from "@/components/Hero";
import { ArchitectureSection } from "@/components/ArchitectureSection";
import { SectionHeading } from "@/components/SectionHeading";
import { externalLinks } from "@/lib/site-data";

const STEPS = [
  {
    n: 1,
    title: "Register",
    detail:
      "Point NANDA Index at your agent: a catalog URL, a DNS record, or a hosted agent card.",
  },
  {
    n: 2,
    title: "Resolve",
    detail:
      "Anyone who has your domain, email, or agent ID can look it up through NANDA Index.",
  },
  {
    n: 3,
    title: "Connect",
    detail:
      "They get your agent's live endpoint and talk to it directly. NANDA Index steps out of the way.",
  },
];

// Docs-style on-page nav, similar in spirit to agenticresourcediscovery.org's sidebar.
const SECTIONS = [
  { id: "what-is-it", label: "What is it" },
  { id: "in-brief", label: "In brief" },
  { id: "interoperability", label: "Interoperability" },
  { id: "who-its-for", label: "Who it's for" },
  { id: "open-source", label: "Open source" },
];

export default function HomePage() {
  return (
    <>
      <Hero />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex items-start gap-10">
        <nav aria-label="On this page" className="hidden lg:block w-48 shrink-0">
          <div className="sticky top-24">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-weak">
              On this page
            </p>
            <ul className="space-y-0.5 border-l border-line">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="-ml-px block border-l-2 border-transparent py-1 pl-3 text-sm text-ink-medium hover:border-line-strong hover:text-brand-600 transition-colors"
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <div className="min-w-0 flex-1 flex flex-col gap-12">
          {/* ── What is it ──────────────────────────────────────────── */}
          <section id="what-is-it">
            <SectionHeading
              eyebrow="What is it"
              title="One lookup for every AI agent"
              description="Give NANDA Index a domain, email, or agent ID and it tells you where that agent's card lives, no matter who built it or how it's hosted. It's a directory, not a runtime: agents stay wherever their owner already hosts them."
            />

            <div className="flex flex-wrap items-center gap-3 rounded-card border border-line p-5 font-mono text-xs sm:text-sm text-ink-medium">
              <span className="rounded-control border border-line px-3 py-1.5 text-ink-strong">Requester</span>
              <span aria-hidden="true">→</span>
              <span className="rounded-control border border-line px-3 py-1.5 text-ink-strong">NANDA Index</span>
              <span aria-hidden="true">→</span>
              <span className="rounded-control border border-line px-3 py-1.5 text-ink-strong">Catalog / DNS / Agent Card</span>
              <span aria-hidden="true">→</span>
              <span className="rounded-control border border-line px-3 py-1.5 text-ink-strong">Agent Runtime</span>
            </div>
          </section>

          {/* ── In brief ─────────────────────────────────────────────── */}
          <section id="in-brief">
            <SectionHeading
              eyebrow="In brief"
              title="Three steps"
              description="The same three steps apply whether you're an enterprise, a small business, or one person with an email address."
            />

            <div className="grid gap-4 sm:grid-cols-3">
              {STEPS.map((step) => (
                <div
                  key={step.n}
                  className="rounded-card border border-line p-5"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-800 text-xs font-bold text-white">
                    {step.n}
                  </div>
                  <h3 className="mt-3 font-semibold text-ink-strong">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-medium">{step.detail}</p>
                </div>
              ))}
            </div>

            <Link
              href="/how-it-works"
              className="mt-4 inline-block text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors"
            >
              See the full resolution flow →
            </Link>
          </section>

          {/* ── Interoperability ────────────────────────────────────── */}
          <section id="interoperability">
            <SectionHeading
              eyebrow="Interoperability"
              title="Also speaks ARD"
              description="Alongside its own API, NANDA Index exposes an ARD (Agentic Resource Discovery)-compliant registry surface, the same open format used by ora.ai, so any ARD-aware client can search and browse it directly. No NANDA-specific integration required."
            />

            <div className="flex flex-wrap items-center gap-3 rounded-card border border-line p-5 font-mono text-xs sm:text-sm text-ink-medium">
              <span className="rounded-control border border-line px-3 py-1.5 text-ink-strong">GET /api/ard</span>
              <span className="rounded-control border border-line px-3 py-1.5 text-ink-strong">POST /api/ard/search</span>
              <span className="rounded-control border border-line px-3 py-1.5 text-ink-strong">POST /api/ard/explore</span>
              <span className="rounded-control border border-line px-3 py-1.5 text-ink-strong">GET /api/ard/agents</span>
            </div>

            <a
              href={externalLinks.ardSpec}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors"
            >
              Learn more about ARD →
            </a>
          </section>

          {/* ── Who it's for ────────────────────────────────────────── */}
          <ArchitectureSection />

          {/* ── Open source & paper ──────────────────────────────────── */}
          <section id="open-source">
            <SectionHeading eyebrow="Open source" title="Specified in the open" />

            <div className="rounded-card border border-line p-6 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1">
                <p className="text-sm text-ink-medium">
                  The code is on GitHub{externalLinks.paper ? ", and the architecture is written up in a paper." : "."}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a
                  href={externalLinks.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center h-9 rounded-control border-2 border-line px-4 text-sm font-medium text-ink hover:border-line-strong transition"
                >
                  View on GitHub
                </a>
                {externalLinks.paper ? (
                  <a
                    href={externalLinks.paper}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center h-9 rounded-control border-2 border-line px-4 text-sm font-medium text-ink hover:border-line-strong transition"
                  >
                    Read the paper
                  </a>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
