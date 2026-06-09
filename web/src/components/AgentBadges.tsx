import { cn } from "@/lib/utils";

export function ProtocolBadge({ protocol }: { protocol: string }) {
  const colors: Record<string, string> = {
    a2a:   "border-violet-200 bg-violet-50 text-violet-700",
    mcp:   "border-blue-200 bg-blue-50 text-blue-700",
    rest:  "border-slate-200 bg-slate-50 text-slate-700",
    https: "border-teal-200 bg-teal-50 text-teal-700",
  };
  return (
    <span className={cn(
      "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em]",
      colors[protocol] ?? colors.rest,
    )}>
      {protocol}
    </span>
  );
}

export function VisibilityBadge({ visibility }: { visibility: string }) {
  return (
    <span className={cn(
      "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em]",
      visibility === "private"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-emerald-200 bg-emerald-50 text-emerald-700",
    )}>
      {visibility}
    </span>
  );
}
