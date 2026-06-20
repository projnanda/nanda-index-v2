import type { ReactNode } from "react";

type Props = {
  eyebrow?: string;
  title: string;
  description: string;
  children: ReactNode;
};

export function PageShell({ eyebrow, title, description, children }: Props) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8">
        {eyebrow ? (
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--color-fg-weak)]">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-3xl font-semibold tracking-[-0.01em] text-[color:var(--color-fg-strong)]">
          {title}
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[color:var(--color-fg-muted)]">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}
