import type { OrgStatus } from "@/lib/nanda-types";
import { cn } from "@/lib/utils";

type StatusValue = OrgStatus | "active" | "inactive";

export function StatusBadge({ status }: { status: StatusValue }) {
  const styles: Record<string, string> = {
    active:    "bg-success-soft text-success",
    pending:   "bg-warning-soft text-warning",
    suspended: "bg-danger-soft text-danger",
    inactive:  "bg-surface-strong text-ink-weak",
  };

  return (
    <span
      className={cn(
        "brand-tag inline-flex items-center px-2.5 py-0.5 rounded-full uppercase",
        styles[status] ?? "bg-surface-tag text-ink",
      )}
    >
      {status}
    </span>
  );
}
