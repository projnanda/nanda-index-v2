import { cn } from "@/lib/utils";

export function ProtocolBadge({ protocol }: { protocol: string }) {
  const colors: Record<string, string> = {
    a2a:   "bg-[color:var(--color-primary-soft)] text-[color:var(--color-primary)]",
    mcp:   "bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent)]",
    rest:  "bg-[color:var(--color-surface-2)] text-[color:var(--color-fg-muted)]",
    https: "bg-[color:var(--color-warning-soft)] text-[color:var(--color-warning)]",
  };
  return (
    <span className={cn(
      "inline-flex rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide",
      colors[protocol] ?? colors.rest,
    )}>
      {protocol}
    </span>
  );
}

export function VisibilityBadge({ visibility }: { visibility: string }) {
  return (
    <span className={cn(
      "inline-flex rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide",
      visibility === "private"
        ? "bg-[color:var(--color-warning-soft)] text-[color:var(--color-warning)]"
        : "bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent)]",
    )}>
      {visibility}
    </span>
  );
}
