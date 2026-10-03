import { PageShell } from "@/components/PageShell";

type Contributor = {
  name: string;
  organization: string;
};

const CONTRIBUTORS: Contributor[] = [
  { name: "Ramesh Raskar", organization: "MIT Media Lab and ProjectNANDA.org" },
  { name: "Pradyumna Chari", organization: "MIT Media Lab" },
  { name: "Luca Muscariello", organization: "Cisco" },
  { name: "Samuel Sharaf", organization: "Google" },
  { name: "Junjie Bu", organization: "Google" },
  { name: "Karan Bharadwaj", organization: "Nasiko and ProjectNANDA.org" },
  { name: "Vijoy Pandey", organization: "Cisco" },
  { name: "Ankit Kumar Nath", organization: "Nasiko" },
  { name: "Sharath Chandra", organization: "Project Nanda" },
  { name: "Umamaheswar Edara", organization: "Project Nanda" },
  { name: "Vedh Krishnan", organization: "Project Nanda" },
  { name: "Chaman Singhal", organization: "Nasiko" },
  { name: "Gaurav Tiwari", organization: "Nasiko" },
];

export default function ContributorsPage() {
  return (
    <PageShell
      title="Contributors"
      description="Nanda Index is being designed, reviewed, and supported by agent builders."
    >
      <ul className="max-w-3xl list-disc space-y-3 pl-6">
        {CONTRIBUTORS.map((person) => (
          <li key={person.name}>
            <span className="font-medium text-ink-strong">{person.name}</span>
            <span className="text-sm text-ink-medium"> - {person.organization}</span>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
