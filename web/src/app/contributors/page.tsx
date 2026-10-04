import { PageShell } from "@/components/PageShell";

type Contributor = {
  name: string;
  organization: string;
};

type Paper = {
  title: string;
  href: string;
  authors: string[];
};

const CONTRIBUTORS: Contributor[] = [
  { name: "Ankit Kumar Nath", organization: "Nasiko and ProjectNANDA.org" },
  { name: "Sharath Chandra", organization: "StellarMinds.ai and ProjectNANDA.org" },
  { name: "Umamaheswar Edara", organization: "ProjectNANDA.org" },
  { name: "Vedh Krishnan", organization: "ProjectNANDA.org" },
  { name: "Chaman Singhal", organization: "Nasiko" },
  { name: "Gaurav Tiwari", organization: "Nasiko" },
];

const PAPERS: Paper[] = [
  {
    title:
      "A Global Switchboard for the Agentic Web: Connecting Discovery Islands Across Enterprises, SMBs, and Individuals",
    href: "https://nandaindex.org/paper.pdf",
    authors: [
      "Ramesh Raskar (MIT Media Lab and ProjectNANDA.org)",
      "Pradyumna Chari (MIT Media Lab)",
      "Luca Muscariello (Cisco)",
      "Samuel Sharaf (Google)",
      "Junjie Bu (Google)",
      "Karan Bharadwaj (Nasiko and ProjectNANDA.org)",
      "Vijoy Pandey (Cisco)",
    ],
  },
  {
    title:
      "Beyond DNS: Unlocking the Internet of AI Agents via the NANDA Index and Verified AgentFacts",
    href: "https://arxiv.org/abs/2507.14263",
    authors: [
      "Ramesh Raskar",
      "Pradyumna Chari",
      "John Zinky",
      "Mahesh Lambe",
      "Jared James Grogan",
      "Sichao Wang",
      "Rajesh Ranjan",
      "Rekha Singhal",
      "Shailja Gupta",
      "Robert Lincourt",
      "Raghu Bala",
      "Aditi Joshi",
      "Abhishek Singh",
      "Ayush Chopra",
      "Dimitris Stripelis",
      "Bhuwan B",
      "Sumit Kumar",
      "Maria Gorskikh",
    ],
  },
  {
    title:
      "Evolution of AI Agent Registry Solutions: Centralized, Enterprise, and Distributed Approaches",
    href: "https://arxiv.org/abs/2508.03095",
    authors: [
      "Aditi Singh",
      "Abul Ehtesham",
      "Mahesh Lambe",
      "Jared James Grogan",
      "Abhishek Singh",
      "Saket Kumar",
      "Luca Muscariello",
      "Vijoy Pandey",
      "Guillaume Sauvage De Saint Marc",
      "Pradyumna Chari",
      "Ramesh Raskar",
    ],
  },
];

export default function ContributorsPage() {
  return (
    <PageShell
      title="Contributors"
      description="Nanda Index is being designed, reviewed, and supported by agent builders."
    >
      <div className="max-w-3xl space-y-12">
        {PAPERS.map((paper) => (
          <section key={paper.href}>
            <h2 className="mb-1 font-display text-lg font-semibold text-ink-strong">
              <a
                href={paper.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 hover:text-brand-700 transition-colors"
              >
                {paper.title} <span aria-hidden="true">↗</span>
              </a>
            </h2>
            <p className="mb-4 text-xs font-bold uppercase tracking-wide text-ink-weak">
              Authors
            </p>
            <ul className="list-disc space-y-1 pl-6 text-sm text-ink-medium">
              {paper.authors.map((author) => (
                <li key={author}>{author}</li>
              ))}
            </ul>
          </section>
        ))}

        <section>
          <h2 className="mb-4 font-display text-lg font-semibold text-ink-strong">
            Contributors
          </h2>
          <ul className="list-disc space-y-3 pl-6">
            {CONTRIBUTORS.map((person) => (
              <li key={person.name}>
                <span className="font-medium text-ink-strong">{person.name}</span>
                <span className="text-sm text-ink-medium"> - {person.organization}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PageShell>
  );
}
