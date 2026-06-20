import Link from "next/link";

type Props = {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
};

export function TableEmptyState({
  title,
  description,
  actionLabel,
  actionHref,
}: Props) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-8 text-center shadow-[var(--shadow-card)]">
      <h3 className="text-lg font-semibold text-[color:var(--color-fg-strong)]">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[color:var(--color-fg-muted)]">{description}</p>
      {actionLabel && actionHref ? (
        <Link
          href={actionHref}
          className="mt-5 inline-flex h-10 items-center rounded-[var(--radius-control)] bg-[color:var(--color-primary)] px-4 text-sm font-medium text-white transition-colors hover:bg-[color:var(--color-primary-hover)]"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
