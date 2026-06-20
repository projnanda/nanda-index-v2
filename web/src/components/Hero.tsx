import { heroStats } from "@/lib/site-data";

export function Hero() {
  return (
    <section className="mx-auto max-w-7xl px-4 pb-6 pt-10 sm:px-6 lg:px-8 lg:pt-16">
      <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-fg-weak)]">
            Nanda Index
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight tracking-[-0.01em] text-[color:var(--color-fg-strong)] sm:text-5xl">
            Federated resolution for the agentic web.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-[color:var(--color-fg-muted)]">
            NandaIndex resolves any agent identity (domain, email, or URN) to the
            correct next discovery object: AI Catalog, DNS-AID, A2A Agent Card, or
            personal agent card. It bridges agent discovery across enterprises, small
            businesses, and individuals without replacing existing discovery systems.
          </p>

          <div className="mt-8 flex flex-wrap gap-2">
            {["Enterprise", "SMB", "Individual"].map((item) => (
              <span
                key={item}
                className="inline-flex items-center rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[color:var(--color-fg-default)] transition-colors hover:bg-[color:var(--color-primary-soft)] hover:text-[color:var(--color-primary-deep)]"
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
              className="rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5 shadow-[var(--shadow-card)]"
            >
              <div className="text-3xl font-semibold text-[color:var(--color-primary)]">
                {stat.value}
              </div>
              <div className="mt-2 text-xs font-medium uppercase tracking-wide text-[color:var(--color-fg-weak)]">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
