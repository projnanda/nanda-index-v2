import { cn } from "@/lib/utils";

export function ProtocolBadge({ protocol }: { protocol: string }) {
  const colors: Record<string, string> = {
    a2a:   "bg-brand-200 text-brand-800",
    mcp:   "bg-accent-teal text-accent-teal-ink",
    rest:  "bg-surface-tag text-ink",
    https: "bg-warning-soft text-warning",
  };
  return (
    <span className={cn(
      "brand-tag inline-flex items-center px-2.5 py-0.5 rounded-full uppercase",
      colors[protocol] ?? colors.rest,
    )}>
      {protocol}
    </span>
  );
}

export function VisibilityBadge({ visibility }: { visibility: string }) {
  return (
    <span className={cn(
      "brand-tag inline-flex items-center px-2.5 py-0.5 rounded-full uppercase",
      visibility === "private"
        ? "bg-warning-soft text-warning"
        : "bg-accent-teal text-accent-teal-ink",
    )}>
      {visibility}
    </span>
  );
}
