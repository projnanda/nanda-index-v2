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
    <div className="rounded-3xl border border-black/10 bg-white p-8 text-center shadow-sm">
      <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
      {actionLabel && actionHref ? (
        <Link
          href={actionHref}
          className="mt-5 inline-flex rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}