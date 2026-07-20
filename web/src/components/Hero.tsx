import Link from "next/link";
import { heroStats, externalLinks } from "@/lib/site-data";

export function Hero() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-6 pt-10 lg:pt-16">
      <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-ink-weak">
            Nanda Index
          </p>
          <h1 className="mt-4 max-w-3xl font-display text-3xl sm:text-4xl font-semibold text-ink-strong leading-tight tracking-[-0.01em]">
            Federated resolution for the agentic web.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-ink-medium">
            NandaIndex resolves any agent identity (domain, email, or URN) to the
            correct next discovery object: AI Catalog, DNS-AID, A2A Agent Card, or
            personal agent card. It bridges agent discovery across enterprises, small
            businesses, and individuals without replacing existing discovery systems.
          </p>

          <div className="mt-8 flex flex-wrap gap-2">
            {["Enterprise", "SMB", "Individual"].map((item) => (
              <span
                key={item}
                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-surface-tag text-ink"
              >
                {item}
              </span>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/explore"
              className="inline-flex items-center justify-center h-9 rounded-control bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600 transition"
            >
              Explore the index
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center h-9 rounded-control border-2 border-line bg-surface-light px-4 text-sm font-medium text-ink hover:border-line-strong transition"
            >
              Register your agent
            </Link>
            <a
              href={externalLinks.github}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 justify-center h-9 rounded-control border-2 border-line bg-surface-light px-4 text-sm font-medium text-ink hover:border-line-strong transition"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.09 3.29 9.4 7.86 10.93.57.1.79-.25.79-.55 0-.27-.01-1-.02-1.96-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11.05 11.05 0 015.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.8 1.19 1.83 1.19 3.09 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.07.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .3.21.66.8.55A10.51 10.51 0 0023.5 12C23.5 5.65 18.35.5 12 .5z" />
              </svg>
              GitHub
            </a>
            {externalLinks.paper ? (
              <a
                href={externalLinks.paper}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center h-9 rounded-control border-2 border-line bg-surface-light px-4 text-sm font-medium text-ink hover:border-line-strong transition"
              >
                Read the paper
              </a>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {heroStats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-card border border-line p-6"
            >
              <div className="text-3xl font-semibold text-brand-500">
                {stat.value}
              </div>
              <div className="mt-2 text-xs font-bold uppercase tracking-wide text-ink-weak">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
