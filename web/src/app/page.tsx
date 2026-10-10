import { externalLinks } from "@/lib/site-data";

export default function HomePage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div className="space-y-5 text-base leading-relaxed text-ink-medium">
        <p>
          Software agents are increasingly able to discover, compose, and invoke one
          another&apos;s capabilities across organizational boundaries. The mechanisms
          used to discover these agents, however, are diverging. Enterprises,
          platforms, and developer communities have each adopted different systems,
          including AI Catalogs, DNS-based service discovery, enterprise gateways,
          agent descriptors such as A2A Agent Cards and MCP servers, and a growing set
          of platform, telecom, and sector-specific registries. Each system is
          authoritative within its own domain, but no common layer connects them.
          This fragments the ecosystem into isolated discovery islands.
        </p>

        <p>
          The missing piece is a resolution layer that complements discovery
          protocols (such as ARD) by bridging resource identifiers to the appropriate
          discovery entry point. Given a stable resource identifier, such as{" "}
          <span className="font-mono text-sm">urn:air:moonbakery.com:agent:orders</span>,
          this layer determines which discovery mechanism a requester should use and
          then defers to that mechanism. Because it reuses the AI Catalog format as
          its record type, it introduces no new schema.
        </p>

        <p>
          NandaIndex is a concrete realization of that layer: a global switchboard
          across heterogeneous systems. It extends the NANDA and AGNTCY switchboard,
          built jointly by Outshift (Cisco) and MIT Media Lab, by leveraging the ARD
          and AI Catalog standards as the foundation to unify identity, trust, and
          federation across platforms.
        </p>

        <p>It applies to three settings:</p>

        <ul className="list-disc space-y-3 pl-6">
          <li>
            Enterprises with mixed discovery infrastructure: some publish an AI
            Catalog at a well-known endpoint, others use DNS-based service discovery
            (DNS-SD, SVCB), gateways, or legacy registries.
          </li>
          <li>
            Small businesses such as Moon Bakery, whose agent runtime (e.g. AWS) and
            agent card (e.g. host39.org) are hosted by separate providers.
          </li>
          <li>
            Individuals such as john@hotmail.com, who do not own a domain. Their
            identifier is anchored to the card host, for example{" "}
            <span className="font-mono text-sm">urn:air:host39.org:personal:john-hotmail-com</span>.
          </li>
        </ul>
      </div>

      <p className="mt-10 text-sm text-ink-medium">
        The reference implementation is on GitHub, and you can host your own agent facts on host39.org.
      </p>

      <div className="mt-3 flex flex-wrap gap-3">
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
