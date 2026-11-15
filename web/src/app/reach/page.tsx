import type { Metadata } from "next";
import { externalLinks } from "@/lib/site-data";

// The nandaindex.org/reach extension, version 1. The URI is the extension's
// identifier in Poppy-Extensions headers and poppy.json, so this page is what a
// reader finds when they open it. The text follows the reference implementation
// (REFERENCE_REPO): docs/reach.md there is the same specification in Markdown.

export const metadata: Metadata = {
  title: "nandaindex.org/reach",
  description:
    "A Personal Agent Protocol (Poppy) extension: a company keeps only a person's NANDA locator and resolves it in the NANDA Index at send time, so it can reach the person's agent later.",
};

const REFERENCE_REPO = "https://github.com/Sharathvc23/nanda-reach-demo";
const SLIDES_PDF = `${REFERENCE_REPO}/blob/main/docs/ietfdawn2026.pdf`;
const LIVE_AGENT = "https://mymuse.stellarminds.ai";
const LIVE_COMPANY = "https://travel26-production.up.railway.app";

const POPPY_JSON = `"extensions": {
  "nandaindex.org/reach": [
    {
      "version": "1",
      "index": "https://api.nandaindex.org",
      "message_topics": ["travel", "promotion"],
      "sender": "travel26desk@inkboxmail.com",
      "endpoint": "https://travel26.example/poppy/reach",
      "description": "What the Company keeps and how it reaches you."
    }
  ]
}`;

const CLIENT_METADATA = `{
  "client_id": "https://agent.example/poppy/client.json",
  "client_name": "mymuse",
  "jwks_uri": "https://agent.example/poppy/jwks.json",
  "nanda_locator": "urn:air:host39.org:personal:john@example.com",
  "nanda_card": "https://agent.example/.well-known/agent-card.json"
}`;

const CARD_FIELDS = `"agents": [
  { "id": "muse", "name": "John on Muse", "harness": "muse",
    "inbox": { "kind": "inkbox", "address": "johnmuse@inkboxmail.com" } },
  { "id": "wajo", "name": "John on Wajo", "harness": "wajo",
    "inbox": { "kind": "inkbox", "address": "john@inkboxmail.com" } }
],
"routing": [
  { "match": "travel",    "deliver_to": "wajo" },
  { "match": "promotion", "deliver_to": "none" },
  { "match": "*",         "deliver_to": "muse" }
],
"version": "2"`;

const TERMS = [
  ["Company", "The site a Personal Agent acts on, as in Poppy. Publishes /.well-known/poppy.json."],
  ["Personal Agent", "The agent acting for the person, as in Poppy. Has a client_id URL and a client metadata document."],
  [
    "NANDA locator",
    "A URN of the form urn:air:<publisher>:personal:<email>, registered in the NANDA Index by the person. Example: urn:air:host39.org:personal:john@example.com.",
  ],
  [
    "NANDA Index",
    "The resolution service. GET /api/v1/resolve?locator=<locator> returns the entry, which names the current agent card URL. Reference deployment: https://api.nandaindex.org.",
  ],
  [
    "Agent card",
    "An A2A-shaped JSON document the person hosts at a URL of their choice. For this extension it carries two additional fields, agents and routing (section 6).",
  ],
  ["Topic", "A short label the Company attaches to a message, such as travel or promotion. The card routes by topic."],
];

const POPPY_FIELDS = [
  ["version", "yes", '"1".'],
  ["index", "yes", "Base URL of the NANDA Index the Company resolves against."],
  ["message_topics", "yes", "Topics the Company may send. A person can route or decline each one on their card."],
  ["sender", "yes", "The address messages will come from, so the person can recognise and filter them."],
  ["endpoint", "no", "A URL that documents the Company's use of the extension in human- and machine-readable form."],
  ["description", "no", "One sentence for the person."],
];

const METADATA_FIELDS = [
  ["nanda_locator", "yes", "The person's NANDA locator."],
  [
    "nanda_card",
    "no",
    "Where the card lives today. Informational only. The Company MUST NOT use it to reach the person; it MUST resolve the locator instead (section 5).",
  ],
];

const CARD_FIELD_ROWS = [
  ["agents[].id", "Stable id referenced by routing."],
  ["agents[].inbox.kind", "Delivery mechanism. This version defines inkbox (an InkBox mailbox address). Other kinds may be added."],
  ["agents[].inbox.address", "The address for that kind."],
  ["routing[].match", 'A topic, or "*" for everything else. First match wins.'],
  ["routing[].deliver_to", 'An agent id on the card, or "none": the person declines the topic.'],
  ["version", "Incremented on every change, so a sender can log which version it followed."],
];

const SEND_STEPS = [
  "Resolves the locator: GET <index>/api/v1/resolve?locator=<locator>.",
  "Takes the entry's registry_url (or url) as the card URL and checks the entry's status is active.",
  "Fetches the card and checks it has agents and routing.",
  'Walks routing in order and takes the first rule whose match is in T or is "*".',
  'If the rule\'s deliver_to is "none", the person declines this topic: the Company MUST NOT send, and SHOULD record the hold as the person\'s choice rather than an error.',
  "Otherwise delivers to the inbox of the agent whose id equals deliver_to, by that inbox's kind.",
];

const CONSIDERATIONS = [
  "The locator is derived from an email address. A Personal Agent SHOULD share it only with Companies the person has chosen to deal with, and only when the person has agreed to be contacted later. The opt-in is per session, not per agent.",
  "The Company learns nothing about where the person's agents are until it sends, and nothing it learns at send time is kept. Changing agents, hosts or preferences does not require telling any Company.",
  "The Index entry is controlled by the person's Index account. Integrity of the card itself (that the document fetched is the one the person published) is out of scope for this version and is the subject of separate work.",
  "Declining a topic is expressed on the card, where the person can see and change it, rather than in per-Company settings.",
  'A Company MUST honour "none" and MUST NOT fall back to a cached inbox or card URL when resolution fails.',
];

const RELATED = [
  {
    name: "Personal Agent Protocol 1.0",
    href: "https://personalagentprotocol.org/",
    text: "Session, client metadata, Poppy-Extensions. This extension adds two metadata fields and one poppy.json entry; it changes nothing in the session mechanics.",
  },
  { name: "A2A agent cards", href: null, text: "The card remains a valid A2A card; agents and routing are additive." },
  {
    name: "NANDA Index",
    href: externalLinks.paper,
    text: "The locator is the stable resource identifier, the Index the resolution layer, the card the discovery entry point.",
  },
  {
    name: "IETF DAWN",
    href: externalLinks.ietfDraft,
    text: "DNS-AID anchors discovery in a DNS zone the subject owns; mDNS in the local link. A NANDA locator anchors a personal agent in a verified email, for people who have no domain of their own. The approaches compose: an enterprise anchors in DNS, a person in the Index, and a card can carry both.",
  },
];

const IMPLEMENTATION = [
  ["Company side: poppy.json, /poppy/reach, MCP tools, the send-time chain", "src/travel26/app.ts, src/travel26/resolver.ts"],
  ["Personal Agent side: client metadata, header, card editing", "src/mymuse/poppy-client.ts, src/mymuse/card.ts"],
  ["Card schema and routing", "src/shared/card.ts"],
  ["Poppy session verification", "src/shared/poppy.ts"],
];

const linkClass = "text-brand-600 underline underline-offset-4 hover:text-brand-700";
const h2Class = "mt-10 text-lg font-bold text-ink-strong";
const h3Class = "mt-6 font-semibold text-ink-strong";
const pClass = "mt-2 text-sm leading-relaxed text-ink-medium";
const preClass =
  "mt-3 overflow-x-auto rounded-card border border-line bg-surface-light p-4 font-mono text-xs leading-relaxed text-ink";
const codeClass = "rounded-sm bg-surface-tag px-1 py-0.5 font-mono text-[0.85em] text-ink-strong";

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-card border border-line">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-strong text-xs font-bold uppercase tracking-wide text-ink-weak">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]} className="border-t border-line align-top">
              {row.map((cell, i) => (
                <td key={i} className={`px-3 py-2 leading-relaxed ${i === 0 ? "whitespace-nowrap font-mono text-xs text-ink-strong" : "text-ink-medium"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReachPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-weak">Poppy extension · version 1 · draft of 15 November 2026</p>
      <h1 className="mt-2 font-mono text-2xl font-bold text-ink-strong">nandaindex.org/reach</h1>
      <p className="mt-3 text-base leading-relaxed text-ink-strong">
        A Personal Agent Protocol (Poppy) extension for reaching a person&apos;s agent later, through the NANDA Index.
      </p>
      <p className={pClass}>
        Status: proposal, with a running reference implementation. Feedback is welcome as an issue on the{" "}
        <a href={REFERENCE_REPO} className={linkClass}>
          reference repository
        </a>{" "}
        or on the IETF DAWN list.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-sm leading-relaxed text-ink-medium">
        <li>
          Reference implementation and demo:{" "}
          <a href={REFERENCE_REPO} className={linkClass}>
            github.com/Sharathvc23/nanda-reach-demo
          </a>
        </li>
        <li>
          Slides, IETF 127 Hackathon:{" "}
          <a href={SLIDES_PDF} className={linkClass}>
            ietfdawn2026.pdf
          </a>
        </li>
        <li>
          Live: John&apos;s agent at{" "}
          <a href={LIVE_AGENT} className={linkClass}>
            mymuse.stellarminds.ai
          </a>
          , the company at{" "}
          <a href={LIVE_COMPANY} className={linkClass}>
            travel26-production.up.railway.app
          </a>
        </li>
      </ul>

      <section id="purpose" className="scroll-mt-24">
        <h2 className={h2Class}>1. Purpose</h2>
        <p className={pClass}>
          Poppy 1.0 lets a Personal Agent find a Company through <code className={codeClass}>/.well-known/poppy.json</code>, open a
          pseudonymous session and use the Company&apos;s APIs. It has no way for the Company to contact the Personal Agent after the
          session is over. Push notifications are on Poppy&apos;s roadmap, not in the specification.
        </p>
        <p className={pClass}>
          This extension gives the Company one durable thing to keep: the person&apos;s <b>NANDA locator</b>, a stable identifier that
          starts from a verified email and is resolved in the NANDA Index. Everything that can change later, which agent the person
          uses, where the agent card lives, which inbox a topic goes to, is looked up at send time. The Company never stores an inbox
          address, an endpoint or a card URL.
        </p>
        <pre className={preClass}>locator → Index entry → agent card → routing rule → inbox</pre>
        <p className={pClass}>The locator is the only link held by the Company. Every hop after it is controlled by the person.</p>
      </section>

      <section id="terms" className="scroll-mt-24">
        <h2 className={h2Class}>2. Terms</h2>
        <Table head={["Term", "Meaning"]} rows={TERMS} />
        <p className={pClass}>The key words MUST, MUST NOT, SHOULD and MAY are to be read as in BCP 14.</p>
      </section>

      <section id="company" className="scroll-mt-24">
        <h2 className={h2Class}>3. Company declaration in poppy.json</h2>
        <p className={pClass}>
          A Company that supports the extension lists it under <code className={codeClass}>extensions</code> in its poppy.json:
        </p>
        <pre className={preClass}>{POPPY_JSON}</pre>
        <Table head={["Field", "Required", "Meaning"]} rows={POPPY_FIELDS} />
      </section>

      <section id="agent" className="scroll-mt-24">
        <h2 className={h2Class}>4. Personal Agent opt-in</h2>
        <p className={pClass}>The Personal Agent opts in per session by sending the Poppy extensions header on its requests:</p>
        <pre className={preClass}>{'Poppy-Extensions: "nandaindex.org/reach";v="1"'}</pre>
        <p className={pClass}>
          and by publishing the locator in its <b>client metadata document</b> (the document at its{" "}
          <code className={codeClass}>client_id</code> URL, which the Company already fetches to verify the Poppy-Session JWT):
        </p>
        <pre className={preClass}>{CLIENT_METADATA}</pre>
        <Table head={["Field", "Required", "Meaning"]} rows={METADATA_FIELDS} />
        <p className={pClass}>
          The Company reads <code className={codeClass}>nanda_locator</code> only when the header is present with a matching version. A
          request without the header is an ordinary Poppy request and nothing is stored.
        </p>
        <p className={pClass}>
          Because the metadata document is fetched over HTTPS from the client_id origin and the session JWT is verified against the keys
          that document names, the locator arrives bound to the same identity as the session.
        </p>
        <h3 className={h3Class}>4.1 Alternative: a tool call</h3>
        <p className={pClass}>A Company that exposes an MCP API MAY also offer a tool for agents that do not implement the header:</p>
        <pre className={preClass}>{'share_nanda_locator({ nanda_locator: "urn:air:…" })'}</pre>
        <p className={pClass}>The effect is identical to the header path. The reference implementation offers both.</p>
      </section>

      <section id="storage" className="scroll-mt-24">
        <h2 className={h2Class}>5. What the Company stores, and how it reaches the person</h2>
        <p className={pClass}>
          The Company stores, per known agent: the Poppy <code className={codeClass}>client_id</code>, the pseudonymous user id (
          <code className={codeClass}>sub</code>) and the <code className={codeClass}>nanda_locator</code>.
        </p>
        <p className={pClass}>
          The Company MUST NOT store, for the purpose of contacting the person later: the agent card, any inbox address, any endpoint
          URL, or the card URL returned by the Index. It MAY cache a resolution for a short time within one send.
        </p>
        <p className={pClass}>To send a message with topics T the Company:</p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-6 text-sm leading-relaxed text-ink-medium">
          {SEND_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className={pClass}>
          Because step 1 runs on every send, the person can change agents, re-point their Index entry, move their card to a new URL or
          decline a topic, and the next send follows the new card with no action on the Company&apos;s side. A Company that saved the
          card URL at first contact instead would receive 410 Gone after a move and lose the person; the reference demo shows both side
          by side.
        </p>
      </section>

      <section id="card" className="scroll-mt-24">
        <h2 className={h2Class}>6. Agent card fields</h2>
        <p className={pClass}>
          The card is an A2A agent card (so Index card checks and generic A2A clients accept it) with two added fields:
        </p>
        <pre className={preClass}>{CARD_FIELDS}</pre>
        <Table head={["Field", "Meaning"]} rows={CARD_FIELD_ROWS} />
      </section>

      <section id="security" className="scroll-mt-24">
        <h2 className={h2Class}>7. Security and privacy considerations</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-6 text-sm leading-relaxed text-ink-medium">
          {CONSIDERATIONS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section id="related" className="scroll-mt-24">
        <h2 className={h2Class}>8. Relation to other work</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-6 text-sm leading-relaxed text-ink-medium">
          {RELATED.map((item) => (
            <li key={item.name}>
              <b className="text-ink-strong">
                {item.href ? (
                  <a href={item.href} className={linkClass} target="_blank" rel="noopener noreferrer">
                    {item.name}
                  </a>
                ) : (
                  item.name
                )}
              </b>
              : {item.text}
            </li>
          ))}
        </ul>
      </section>

      <section id="implementation" className="scroll-mt-24">
        <h2 className={h2Class}>9. Reference implementation</h2>
        <Table head={["Piece", "Where in the repository"]} rows={IMPLEMENTATION} />
        <p className={pClass}>
          Live company declaration:{" "}
          <a href={`${LIVE_COMPANY}/.well-known/poppy.json`} className={linkClass}>
            {LIVE_COMPANY.replace("https://", "")}/.well-known/poppy.json
          </a>
          . Live agent card:{" "}
          <a href={`${LIVE_AGENT}/.well-known/agent-card.json`} className={linkClass}>
            {LIVE_AGENT.replace("https://", "")}/.well-known/agent-card.json
          </a>
          .
        </p>
      </section>
    </div>
  );
}
