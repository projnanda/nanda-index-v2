import Link from "next/link";
import { externalLinks } from "@/lib/site-data";

// Explanations follow Sections VI and VII of the linked paper.
const STAGES = [
  {
    id: "identifier",
    label: "Resource identifier",
    definition:
      "A resource identifier is a stable identifier used to initiate resolution, such as a domain, DID, or provider-verified account identifier.",
  },
  {
    id: "resolution",
    label: "Resolution",
    definition:
      "Resolution determines where and how discovery should begin. The resolution layer maps resource identifiers to the appropriate discovery entry point.",
  },
  {
    id: "discovery",
    label: "Discovery",
    definition:
      "The discovery layer defines how agents search for relevant capabilities at runtime. The Agentic Resource Discovery (ARD) specification provides a standard interface for querying and retrieving agentic resources across catalogs and registries.",
  },
  {
    id: "invocation",
    label: "Invocation",
    definition:
      "Invocation is interaction with the selected resource through A2A, MCP, REST, or another supported protocol.",
  },
];

const RESOLUTION_FLOW_STEPS = [
  "A requester starts with a lookup key or subject identity, for example, a domain, email address, DID, or AIR URN.",
  "The requester queries a resolution system.",
  "The system returns AI Catalog-formatted resolution entries.",
  "Each entry specifies a discovery path.",
  "The requester follows that path through ARD, DNS lookup, a gateway, or another native mechanism.",
  "Standard discovery, verification, and invocation proceed.",
];

// "goLive" states what the index requires before an entry is published. It
// follows the server: an entry with a domain is hidden until the domain is
// proven with a DNS TXT record (email confirmation alone does not publish
// it); a personal entry has no domain and is published once its email is
// confirmed. See isProven in server/src/db/queries/organizations.ts and the
// verify-domain and verify-email handlers.
const CONTEXTS = [
  {
    id: "enterprise-ai-catalog",
    title: "Enterprise AI Catalog",
    description:
      "For enterprises that publish AI Catalog at a well-known endpoint and own the domain, direct resolution already works. NandaIndex is not in the critical path. A NandaIndex entry remains useful for fallback, federation visibility, migration, and anti-squatting.",
    goLive:
      "Prove you control the domain by adding the DNS TXT record shown on your org page. Until that record is found, the entry stays pending and hidden from the public index. Confirm your contact email too, so the index can reach you.",
  },
  {
    id: "dns-svcb",
    title: "Enterprise DNS-based service discovery",
    description:
      "SkyBlue uses DNS-based service discovery via SVCB. NandaIndex makes this DNS-based discovery path reachable from the global switchboard while representing the target using a recognized A2A Agent Card type.",
    goLive:
      "Prove you control the domain by adding the ownership DNS TXT record shown on your org page; it is separate from the SVCB records that point resolvers at your agent. Until it is found, the entry stays pending and hidden from the public index. Confirm your contact email too, so the index can reach you.",
  },
  {
    id: "smb-agent-card",
    title: "SMB: Moon Bakery",
    description:
      "Moon Bakery owns moonbakery.com but runs no enterprise infrastructure. Its runtime, agent card, and domain are with three separate providers. Moon Bakery needs only a stable resource identifier and a delegated path. NandaIndex can provide a resolution entry point for SMBs.",
    goLive:
      "Prove you control the domain by adding the DNS TXT record shown on your org page. No agent-discovery DNS records, gateway, or catalog server are needed, but this one ownership record is: until it is found, the entry stays pending and hidden from the public index. Confirm your contact email too, so the index can reach you.",
  },
  {
    id: "personal-agent",
    title: "Individual: john@hotmail.com",
    description:
      "John has no domain. His runtime is on Azure; his agent card is with a third-party host. No personally controlled domain is required. NandaIndex enables identity-first discovery for individuals, when the underlying account identity is verifiably bound to the resolution record.",
    goLive:
      "Confirm the email address the entry is registered with. No domain and no DNS record are needed.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-2xl font-bold text-ink-strong">How it works</h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-medium">
        NandaIndex is an AI Catalog-formatted database of index records. It does
        not introduce a new record format. Each entry points to the correct next
        discovery object for a given resource identifier.
      </p>

      <section
        id="agent-setup"
        aria-labelledby="agent-setup-heading"
        className="mt-8 scroll-mt-24 rounded-lg border border-brand-300 bg-brand-200 p-5"
      >
        <h2 id="agent-setup-heading" className="text-lg font-bold text-ink-strong">
          <a
            href="https://my.nandaindex.org/"
            className="text-brand-600 underline underline-offset-4 hover:text-brand-700"
          >
            my.nandaindex.org
          </a>
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-medium">
          <a
            href="https://my.nandaindex.org/inkbox/SKILL.md"
            className="text-brand-600 underline underline-offset-4 hover:text-brand-700"
          >
            Agent setup instructions (SKILL.md)
          </a>
        </p>
      </section>

      <section id="resolution-flow" className="scroll-mt-24">
        <h2 className="mt-10 text-lg font-bold text-ink-strong">Federated resolution</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-medium">
          Federated resolution separates resolution from discovery. The proposed
          architecture reuses AI Catalog as a unified record format for resolution.
          Each resolution entry is an AI Catalog-compatible record that acts as
          a typed pointer.
        </p>
        <ol className="mt-4 list-decimal space-y-1.5 pl-6 text-sm leading-relaxed text-ink-medium">
          {RESOLUTION_FLOW_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      {STAGES.map((stage) => (
        <section key={stage.id} id={stage.id} className="scroll-mt-24">
          <h3 className="mt-6 font-semibold text-ink-strong">{stage.label}</h3>
          <p className="mt-1 text-sm leading-relaxed text-ink-medium">{stage.definition}</p>
        </section>
      ))}

      <section id="registration" className="scroll-mt-24">
        <h2 className="mt-10 text-lg font-bold text-ink-strong">Deployment contexts and use cases</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-medium">
          The federated resolution architecture applies across heterogeneous
          environments with different infrastructure, identity, and governance models.
        </p>
        {CONTEXTS.map((context) => (
          <section key={context.id} id={context.id} className="scroll-mt-24">
            <h3 className="mt-6 font-semibold text-ink-strong">{context.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-ink-medium">{context.description}</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-medium">
              <span className="font-semibold text-ink-strong">To go live: </span>
              {context.goLive}
            </p>
          </section>
        ))}
      </section>

      <nav aria-label="Related resources" className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm">
        <a href={externalLinks.paper} target="_blank" rel="noopener noreferrer" className="underline hover:text-ink-strong">
          Read the paper
        </a>
        <Link href="/resolve" className="underline hover:text-ink-strong">Resolve an identifier</Link>
        <Link href="/login" className="underline hover:text-ink-strong">Register your organization</Link>
      </nav>
    </div>
  );
}
