import type { OrgStatus } from "@/lib/nanda-types";
import { cn } from "@/lib/utils";

type StatusValue = OrgStatus | "active" | "inactive";

export function StatusBadge({ status }: { status: StatusValue }) {
  const styles: Record<string, string> = {
    active:    "border-emerald-200 bg-emerald-50 text-emerald-700",
    pending:   "border-amber-200 bg-amber-50 text-amber-700",
    suspended: "border-rose-200 bg-rose-50 text-rose-700",
    inactive:  "border-slate-200 bg-slate-50 text-slate-500",
  };

  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em]",
        styles[status] ?? "border-slate-200 bg-slate-50 text-slate-700",
      )}
    >
      {status}
    </span>
  );
}
