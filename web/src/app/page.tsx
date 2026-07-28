import { externalLinks } from "@/lib/site-data";

export default function HomePage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div className="space-y-5 text-base leading-relaxed text-ink-medium">
        <p>
          Agent discovery is diverging into multiple useful approaches — a natural
          consequence of innovation across different communities, use cases, and
          deployment environments. AI Catalog is a useful starting point for public
          enterprise agent and AI-resource discovery. It provides a typed, nestable,
          machine-readable container for heterogeneous AI artifacts: A2A Agent Cards,
          MCP server descriptors, nested catalogs, tools, skills, datasets, gateways,
          and other AI resources.
        </p>

        <p>
          However, AI Catalog needs to be strengthened by allowing other discovery
          mechanisms to connect through it. These include DNS-AID, ANS, .well-known,
          A2A cards, MCP, gateways, and platform registries. In addition, telecom
          directories, EdgeAI registries, IoT systems, and country- or sector-specific
          discovery systems will each continue to solve part of the problem. These
          non-compatible or emerging approaches are valuable — the product of real
          innovation — but they can also create discovery islands when left
          unconnected.
        </p>

        <p>
          A NandaIndex Federated Resolution Architecture is proposed as a global
          switchboard that uses the AI Catalog format itself as the common
          index-record format. NandaIndex strengthens AI Catalog by making it the
          preferred framework through which other discovery systems can be bridged.
          The switchboard proposed by NANDA and AGNTCY, built jointly by Outshift
          (Cisco) and MIT Media Lab, provides the starting point for this
          architecture. The architecture considers improvements to AI
          Catalog and extends the switchboard model to cover enterprises, SMBs, and
          individuals.
        </p>

        <p>The focus is on three practical needs:</p>

        <ul className="list-disc space-y-3 pl-6">
          <li>
            Enterprise heterogeneity, where some companies use AI Catalog and others
            use DNS-AID, gateways, .well-known, or legacy registries.
          </li>
          <li>
            SMBs such as MoonBakery, where website maybe listed on Wix, Squarespace or Shopify, agents may be hosted on AWS while agent cards are hosted by a third party such as host39.org.
          </li>
          <li>
            Individuals such as john@hotmail.com, who do not own a domain name, where
            a personal agent may be hosted on AWS, Azure, GCP, or another provider,
            while the agent card lives elsewhere.
          </li>
        </ul>

        <p>
          NandaIndex presents an architecture proposal and initial design. It
          identifies the missing bootstrap layer between identity and discovery,
          defines the role of NandaIndex within that layer, and outlines the
          identity, trust, and federation mechanisms that must be formalized.
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
