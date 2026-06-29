import Link from "next/link";
import { Hero } from "@/components/Hero";
import { ArchitectureSection } from "@/components/ArchitectureSection";
import { SectionHeading } from "@/components/SectionHeading";

const cards = [
  { href: "/login", title: "Sign In", desc: "Login to manage your organization's index record" },
  { href: "/dashboard", title: "Dashboard", desc: "Register and update your AI Catalog, DNS-AID, gateway, or agent card entry" },
  { href: "/", title: "Overview", desc: "View all active organizations and their discovery paths in the index" },
  { href: "/resolve", title: "Resolve", desc: "Resolve any domain, email, or URN identity to its next discovery object" },
  { href: "/registry", title: "AI Catalog Manager", desc: "Manage agents on your AI Catalog Server" },
];

export default function AboutPage() {
  return (
    <>
      <Hero />

      <section className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Quick actions"
          title="Resolve, register, and browse"
          description="Look up any agent identity, register your organization's index record, or browse all active entries in the index."
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="group"
            >
              <article className="bg-surface-light rounded-card border border-line/70 shadow-card p-4 hover:shadow-card-hover hover:border-line-strong transition cursor-pointer flex flex-col h-full gap-3">
                <h3 className="font-semibold text-ink-strong group-hover:text-brand-600">
                  {card.title}
                </h3>
                <p className="text-sm leading-relaxed text-ink-medium">
                  {card.desc}
                </p>
              </article>
            </Link>
          ))}
        </div>
      </section>

      <ArchitectureSection />
    </>
  );
}
