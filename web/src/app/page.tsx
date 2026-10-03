import { externalLinks } from "@/lib/site-data";

export default function HomePage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div className="space-y-5 text-base leading-relaxed text-ink-medium">
        <p>
          Software agents are increasingly able to discover, compose, and invoke
          one another’s capabilities across organizational boundaries, but the
          mechanisms used to discover them are diverging. Enterprises, platforms,
          and developer communities have each adopted different systems: AI
          Catalogs, DNS-based service discovery such as DNS-AID, ANS, .well-known,
          enterprise gateways, agent descriptors such as A2A Agent Cards and MCP
          servers, and a growing set of platform, telecom, and sector-specific
          registries.
        </p>

        <p>
          Each system is authoritative within its own domain, but no common layer
          connects them. Left unconnected, they fragment the ecosystem into
          isolated discovery islands and prevent agents from finding and using
          capabilities across boundaries.
        </p>

        <p>
          The missing piece is a resolution layer that complements discovery
          protocols such as ARD by bridging resource identifiers to the
          appropriate discovery entry point. Given a stable resource identifier,
          this layer determines which discovery mechanism a requester should use
          and then defers to that mechanism. Because it reuses the AI Catalog
          format as its record type, it introduces no new schema.
        </p>

        <p>
          NandaIndex is a concrete realization of that layer: a global switchboard
          across heterogeneous systems. It extends the switchboard proposed by
          NANDA and AGNTCY, built jointly by Outshift (Cisco) and MIT Media Lab,
          by leveraging ARD and AI Catalog standards as the foundation to unify
          identity, trust, and federation across platforms.
        </p>

        <p>NandaIndex is applied to three settings:</p>

        <ul className="list-disc space-y-3 pl-6">
          <li>
            Enterprises with mixed discovery infrastructure, where some companies
            use AI Catalog and others use DNS-AID, gateways, .well-known, or
            legacy registries.
          </li>
          <li>
            Small businesses such as MoonBakery, whose agent runtime and agent
            card are hosted by separate providers: the website may be on Wix,
            Squarespace, or Shopify, the agent on AWS, and the agent card with a
            third party such as host39.org.
          </li>
          <li>
            Individuals such as john@hotmail.com, who do not own a domain, where a
            personal agent may be hosted on AWS, Azure, GCP, or another provider
            while the agent card lives elsewhere.
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
