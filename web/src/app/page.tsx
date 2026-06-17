import Link from "next/link";
import { Hero } from "@/components/Hero";
import { InfoCards } from "@/components/InfoCards";
import { ArchitectureSection } from "@/components/ArchitectureSection";
import { SectionHeading } from "@/components/SectionHeading";

const cards = [
  { href: "/login", title: "Sign In", desc: "Login with Google or GitHub to manage your organization's index record" },
  { href: "/dashboard", title: "Dashboard", desc: "Register and update your AI Catalog, DNS-AID, gateway, or agent card entry" },
  { href: "/registries", title: "Browse", desc: "View all active organizations and their discovery paths in the index" },
  { href: "/resolve", title: "Resolve", desc: "Resolve any domain, email, or URN identity to its next discovery object" },
  { href: "/query", title: "Query", desc: "Search index records by organization, identity type, or keyword" },
  { href: "/registry", title: "Registry Manager", desc: "Manage agents on your Registry Server" },
];

export default function HomePage() {
  return (
    <>
      <Hero />

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Quick actions"
          title="Resolve, register, and browse"
          description="Look up any agent identity, register your organization's index record, or browse all active entries in the switchboard."
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <h2 className="text-xl font-semibold text-slate-950">{card.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{card.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      <InfoCards />
      <ArchitectureSection />
    </>
  );
}