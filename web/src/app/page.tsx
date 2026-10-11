import { externalLinks } from "@/lib/site-data";

export default function HomePage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div className="space-y-5 text-base leading-relaxed text-ink-medium">
        <p>
          Software agents are increasingly able to discover, compose, and invoke
          one another’s capabilities across organizational boundaries, but the
          mechanisms used to discover them are diverging, a natural consequence
          of innovation across different communities, use cases, and deployment
          environments. AI Catalog is a strong starting point for public
          enterprise discovery. It provides a typed, nestable, machine-readable
          container for heterogeneous AI resources: A2A Agent Cards, MCP server
          descriptors, nested catalogs, tools, skills, gateways, and other AI
          resources.
        </p>

        <p>
          But AI Catalog alone does not connect the wider ecosystem. Enterprises
          also rely on DNS-based service discovery, gateways, and platform
          registries, while telecom directories, EdgeAI and IoT systems, and
          sovereign or sector-specific registries continue to emerge. These
          approaches are valuable, the product of real innovation, and each is
          authoritative within its own domain. Left unconnected, however, they
          form discovery islands.
        </p>

        <p>
          NandaIndex is a Federated Resolution Architecture that acts as a global
          switchboard. Given a stable resource identifier, it determines which
          discovery mechanism a requester should use, then defers to that
          mechanism. It reuses the AI Catalog format as its record type, so it
          introduces no new schema, and connected systems do not need to adopt AI
          Catalog internally. NandaIndex complements discovery protocols such as
          ARD and federated infrastructure such as the AGNTCY Agent Directory. It
          builds on the switchboard proposed by NANDA and AGNTCY, developed
          jointly by Outshift (Cisco) and MIT Media Lab, and extends that model
          with improvements to AI Catalog.
        </p>

        <p>
          Simple cases stay simple. An enterprise that publishes an AI Catalog at
          a well-known endpoint and owns its domain resolves directly, and
          NandaIndex stays out of the critical path. NandaIndex is a distributed
          index of pointers, not a centralized registry, and adds value where
          direct resolution is unavailable:
        </p>

        <ul className="list-disc space-y-3 pl-6">
          <li>
            <strong>Enterprise heterogeneity</strong>, where companies use
            DNS-based service discovery, gateways, or legacy registries instead
            of a published AI Catalog.
          </li>
          <li>
            <strong>SMBs</strong> such as Moon Bakery, whose website may be on
            Wix, Squarespace, or Shopify, whose agent runs on AWS, and whose
            agent card is hosted by a third party such as host39.org.
          </li>
          <li>
            <strong>Individuals</strong> such as john@hotmail.com, who do not own
            a domain, with a personal agent on AWS, Azure, GCP, or another
            provider and an agent card hosted elsewhere, discoverable when their
            account identity is verifiably bound to the resolution record.
          </li>
        </ul>

        <p>
          NandaIndex presents an architecture proposal and initial design. It
          identifies the missing bootstrap layer between resource identifiers and
          discovery, defines the role of NandaIndex within that layer, and
          outlines the identity, trust, and federation mechanisms that must be
          formalized.
        </p>
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
