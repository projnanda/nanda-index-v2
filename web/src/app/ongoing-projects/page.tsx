import { PageShell } from "@/components/PageShell";

type ProjectLink = {
  title: string;
  href: string;
  detail: string;
};

const PROJECTS: ProjectLink[] = [
  {
    title: "Project NANDA",
    href: "https://projectnanda.org",
    detail: "The main Project NANDA site.",
  },
  {
    title: "Nanda Town",
    href: "https://nandatown.projectnanda.org",
    detail: "Composable agent services built on the NANDA stack.",
  },
  {
    title: "NANDA at MIT",
    href: "https://nanda.mit.edu",
    detail: "The NANDA project at MIT.",
  },
  {
    title: "MIT Media Lab publication",
    href: "https://www.media.mit.edu/publications/a-global-switchboard-for-the-agentic-web-connecting-discovery-islands-across-enterprises-smbs-and-individuals/",
    detail:
      "A Global Switchboard for the Agentic Web: connecting discovery islands across enterprises, SMBs, and individuals.",
  },
  {
    title: "Beyond DNS (arXiv)",
    href: "https://arxiv.org/abs/2507.14263",
    detail:
      "Unlocking the Internet of AI Agents via the NANDA Index and Verified AgentFacts.",
  },
  {
    title: "KumbhDoot",
    href: "https://www.kumbhdoot.org/docs/KumbhDoot_Proposal.pdf",
    detail:
      "Every pilgrim empowered with a personal AI agent and civic AI services at Nashik Kumbh Mela 2027.",
  },
  {
    title: "DigiDoot",
    href: "https://digidoot.in/Doot_WhitePaper.pdf",
    detail:
      "Doot, the AI agent for every Indian citizen: national architecture of “Agent One”.",
  },
  {
    title: "Outshift (Cisco) + MIT",
    href: "https://outshift.cisco.com/blog/ai-ml/outshift-mit-agentic-web",
    detail:
      "Building a switchboard for the Internet of Agents: integrating AGNTCY Directory and NANDA Index.",
  },
];

export default function OngoingProjectsPage() {
  return (
    <PageShell
      title="Ongoing Projects"
      description="Websites and publications from the NANDA ecosystem."
    >
      <ul className="max-w-3xl list-disc space-y-4 pl-6">
        {PROJECTS.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand-600 hover:text-brand-700 transition-colors"
            >
              {link.title} <span aria-hidden="true">↗</span>
            </a>
            <p className="mt-0.5 text-sm leading-relaxed text-ink-medium">
              {link.detail}
            </p>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
