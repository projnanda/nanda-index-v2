import type { OrgStatus } from "@/lib/nanda-types";
import { cn } from "@/lib/utils";

type StatusValue = OrgStatus | "active" | "inactive";

export function StatusBadge({ status }: { status: StatusValue }) {
  const styles: Record<string, string> = {
    active:    "bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent)]",
    pending:   "bg-[color:var(--color-warning-soft)] text-[color:var(--color-warning)]",
    suspended: "bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger)]",
    inactive:  "bg-[color:var(--color-surface-2)] text-[color:var(--color-fg-weak)]",
  };

  return (
    <span
      className={cn(
        "inline-flex rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide",
        styles[status] ?? "bg-[color:var(--color-surface-2)] text-[color:var(--color-fg-default)]",
      )}
    >
      {status}
    </span>
  );
}
