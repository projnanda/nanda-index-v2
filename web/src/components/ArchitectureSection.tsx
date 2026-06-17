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

      <div className="overflow-hidden rounded-3xl border border-black/10 bg-white shadow-sm">
        <div className="grid grid-cols-1 divide-y divide-black/5 md:grid-cols-4 md:divide-y-0 md:divide-x">
          <div className="px-5 py-4 text-xs uppercase tracking-[0.2em] text-slate-500">
            Context
          </div>
          <div className="px-5 py-4 text-xs uppercase tracking-[0.2em] text-slate-500">
            Scenario
          </div>
          <div className="px-5 py-4 text-xs uppercase tracking-[0.2em] text-slate-500">
            Example Identity
          </div>
          <div className="px-5 py-4 text-xs uppercase tracking-[0.2em] text-slate-500">
            NandaIndex Role
          </div>
        </div>

        {architectureLayers.map((row) => (
          <div
            key={row.layer}
            className="grid grid-cols-1 gap-3 border-t border-black/5 px-5 py-5 md:grid-cols-4 md:gap-0"
          >
            <div className="font-medium text-slate-950">{row.layer}</div>
            <div className="text-slate-600">{row.function}</div>
            <div className="font-mono text-sm text-slate-500">{row.analogy}</div>
            <div className="text-slate-600">{row.hosted}</div>
          </div>
        ))}
      </div>
    </section>
  );
}