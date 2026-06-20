import { architectureLayers } from "@/lib/site-data";
import { SectionHeading } from "./SectionHeading";

export function ArchitectureSection() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <SectionHeading
        eyebrow="Who it serves"
        title="Three practical use cases"
        description="NandaIndex serves enterprises with heterogeneous discovery, SMBs whose runtime and agent card live apart, and individuals without a domain name."
      />

      <div className="overflow-hidden rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-[var(--shadow-card)]">
        <div className="grid grid-cols-1 divide-y divide-[color:var(--color-border)] bg-[color:var(--color-surface-2)] md:grid-cols-4 md:divide-y-0 md:divide-x">
          <div className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--color-fg-weak)]">
            Context
          </div>
          <div className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--color-fg-weak)]">
            Scenario
          </div>
          <div className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--color-fg-weak)]">
            Example Identity
          </div>
          <div className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--color-fg-weak)]">
            NandaIndex Role
          </div>
        </div>

        {architectureLayers.map((row) => (
          <div
            key={row.layer}
            className="grid grid-cols-1 gap-3 border-t border-[color:var(--color-border)] px-5 py-5 md:grid-cols-4 md:gap-0 md:divide-x md:divide-[color:var(--color-border)]"
          >
            <div className="font-semibold text-[color:var(--color-fg-strong)] md:pr-5">{row.layer}</div>
            <div className="text-sm leading-relaxed text-[color:var(--color-fg-muted)] md:px-5">{row.function}</div>
            <div className="font-mono text-xs text-[color:var(--color-fg-weak)] md:px-5">{row.analogy}</div>
            <div className="text-sm leading-relaxed text-[color:var(--color-fg-muted)] md:pl-5">{row.hosted}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
