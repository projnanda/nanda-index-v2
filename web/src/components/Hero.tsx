import { heroStats } from "@/lib/site-data";

export function Hero() {
  return (
    <section className="mx-auto max-w-7xl px-4 pb-6 pt-10 sm:px-6 lg:px-8 lg:pt-16">
      <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-slate-500">
            Nanda Index
          </p>
          <h1 className="mt-4 max-w-3xl font-serif text-5xl italic tracking-tight text-slate-950 sm:text-6xl">
            Federated resolution for the agentic web.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-600">
            NandaIndex is a global switchboard that connects discovery islands across
            enterprises, SMBs, and individuals. It uses the AI Catalog format as its
            native record format and maps any identity — domain, email, or URN — to the
            correct next discovery object: AI Catalog, DNS-AID, A2A Agent Card, MCP
            descriptor, gateway, or personal agent card.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {["Enterprise", "SMB", "Individual"].map((item) => (
              <span
                key={item}
                className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm"
              >
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {heroStats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm"
            >
              <div className="text-3xl font-semibold text-slate-950">{stat.value}</div>
              <div className="mt-2 text-xs uppercase tracking-[0.22em] text-slate-500">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}