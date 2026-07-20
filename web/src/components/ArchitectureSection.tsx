import { architectureLayers } from "@/lib/site-data";
import { SectionHeading } from "./SectionHeading";

export function ArchitectureSection() {
  return (
    <section id="who-its-for">
      <SectionHeading
        eyebrow="Who it serves"
        title="Three practical use cases"
        description="NandaIndex serves enterprises with heterogeneous discovery, SMBs whose runtime and agent card live apart, and individuals without a domain name."
      />

      <div className="overflow-hidden rounded-card border border-line">
        <div className="grid grid-cols-1 divide-y divide-line bg-surface-strong md:grid-cols-4 md:divide-y-0 md:divide-x">
          <div className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-ink-weak">
            Context
          </div>
          <div className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-ink-weak">
            Scenario
          </div>
          <div className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-ink-weak">
            Example Identity
          </div>
          <div className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-ink-weak">
            NandaIndex Role
          </div>
        </div>

        {architectureLayers.map((row) => (
          <div
            key={row.layer}
            className="grid grid-cols-1 gap-3 border-t border-line px-5 py-5 md:grid-cols-4 md:gap-0 md:divide-x md:divide-line"
          >
            <div className="font-semibold text-ink-strong md:pr-5">{row.layer}</div>
            <div className="text-sm leading-relaxed text-ink-medium md:px-5">{row.function}</div>
            <div className="font-mono text-xs text-ink-weak break-all md:px-5">{row.analogy}</div>
            <div className="text-sm leading-relaxed text-ink-medium md:pl-5">{row.hosted}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
