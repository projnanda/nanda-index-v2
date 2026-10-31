import Link from "next/link";
import { externalLinks } from "@/lib/site-data";

// A live SMB entry, so the example on the page resolves on the public index.
const EXAMPLE_IDENTIFIER = "urn:air:moonbakery39.com:agent:orders";

export default function HomePage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div>
        <h1 className="font-display text-3xl font-semibold leading-tight tracking-[-0.01em] text-ink-strong">
          Federated resolution for the agentic web.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-ink-medium">
          NandaIndex maps a stable resource identifier, such as{" "}
          <code className="font-mono text-sm text-ink">{EXAMPLE_IDENTIFIER}</code>, to the
          discovery object that describes the agent behind it.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/explore"
            className="inline-flex items-center justify-center h-10 rounded-control bg-brand-800 px-5 text-sm font-medium text-white hover:bg-brand-700 transition"
          >
            Explore the index
          </Link>
          <Link
            href="/dashboard/orgs/new"
            className="inline-flex items-center justify-center h-10 rounded-control border-2 border-line px-5 text-sm font-medium text-ink hover:border-line-strong transition"
          >
            Register your agent
          </Link>
        </div>
      </div>

      <div className="mt-10 space-y-5 text-base leading-relaxed text-ink-medium">
        <p>
          The agentic web is an emerging layer of the internet in which
          autonomous and semi-autonomous software agents discover, compose, and
          invoke capabilities across organizational and technological boundaries.
          Enterprises, platforms, and developer communities have each adopted
          different systems, including AI Catalogs, DNS-based service discovery,
          enterprise gateways, agent descriptors such as A2A Agent Cards and MCP
          servers, and a growing set of platform, telecom, and sector-specific
          registries.
        </p>

        <p>
          Each system is authoritative within its own domain, but no common
          layer connects them. This fragments the ecosystem into isolated
          discovery islands and prevents agents from finding and using
          capabilities across boundaries.
        </p>

        <section aria-labelledby="what-is-nandaindex" className="space-y-4 pt-4">
          <h2 id="what-is-nandaindex" className="text-lg font-bold text-ink-strong">
            What is NandaIndex?
          </h2>
          <p>
            NandaIndex is an AI Catalog-formatted federation layer that maps a
            stable resource identifier to the appropriate discovery object, whether
            an AI Catalog, a DNS-based service-discovery path, a gateway, a platform
            registry, or a hosted agent card. It functions as a global switchboard:
            it does not replace existing discovery systems but routes requesters to
            them.
          </p>
        </section>

        <section aria-labelledby="supporting-enterprises" className="space-y-4 pt-4">
          <h2 id="supporting-enterprises" className="text-lg font-bold text-ink-strong">
            Supporting enterprises, small businesses, and individuals
          </h2>
          <p>
            For enterprises that publish AI Catalog at a well-known endpoint and
            own the domain, direct resolution already works. NandaIndex is not in
            the critical path. Small businesses can distribute runtime, agent card,
            and domain across separate providers and still be resolved from one
            resource identifier. NandaIndex enables identity-first discovery for
            individuals, when the underlying account identity is verifiably bound
            to the resolution record.
          </p>
        </section>

        <section aria-labelledby="open-agent-ecosystem" className="space-y-4 pt-4">
          <h2 id="open-agent-ecosystem" className="text-lg font-bold text-ink-strong">
            Complementing the open agent ecosystem
          </h2>
          <p>
            NandaIndex works alongside existing open standards and protocols,
            including AI Catalog, A2A, MCP, Poppy, and emerging payment protocols.
            It provides a common resolution layer while existing systems continue
            to handle agent discovery, communication, authentication, authorization,
            and transactions. NandaIndex does not replace these systems or require
            agents to use a common platform.
          </p>
        </section>

        <section aria-labelledby="open-questions" className="space-y-4 pt-4">
          <h2 id="open-questions" className="text-lg font-bold text-ink-strong">
            Open questions and future work
          </h2>
          <p>
            Several questions remain open, and we expect future work to address
            them:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>Refining resolution semantics and identity models.</li>
            <li>Strengthening trust, verification, and policy mechanisms.</li>
            <li>
              Standardizing the interfaces between the resolution, discovery, and
              infrastructure layers.
            </li>
            <li>
              Supporting richer query routing and multi-hop resolution across
              federated systems.
            </li>
          </ul>
        </section>
      </div>
      <div className="mt-10 flex flex-wrap gap-3">
        <a
          href={externalLinks.paper}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center h-10 rounded-control bg-brand-800 px-5 text-sm font-medium text-white hover:bg-brand-700 transition"
        >
          Read the paper
        </a>
        <a
          href={externalLinks.github}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center h-10 rounded-control border-2 border-line px-5 text-sm font-medium text-ink hover:border-line-strong transition"
        >
          GitHub repo
        </a>
        <a
          href={externalLinks.ietfDraft}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center h-10 rounded-control border-2 border-line px-5 text-sm font-medium text-ink hover:border-line-strong transition"
        >
          IETF Draft
        </a>
        <a
          href={externalLinks.host39}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center h-10 rounded-control border-2 border-line px-5 text-sm font-medium text-ink hover:border-line-strong transition"
        >
          host39.org
        </a>
      </div>
    </div>
  );
}
