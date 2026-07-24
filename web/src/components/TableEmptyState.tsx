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
    <div className="bg-surface-light rounded-card border border-line p-8 text-center shadow-card">
      <h3 className="text-lg font-semibold text-ink-strong">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-medium">{description}</p>
      {actionLabel && actionHref ? (
        <Link
          href={actionHref}
          className="inline-flex items-center justify-center mt-5 h-9 rounded-control bg-brand-500 px-4 text-sm font-medium text-on-brand hover:bg-brand-600 transition"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
