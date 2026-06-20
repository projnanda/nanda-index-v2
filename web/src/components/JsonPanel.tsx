"use client";

import { useState } from "react";
import { prettyJson } from "@/lib/utils";

export function JsonPanel({ data }: { data: unknown }) {
  const [copied, setCopied] = useState(false);
  const json = prettyJson(data);

  async function copy() {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="min-w-0 rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-code-bg)] text-[color:var(--color-code-fg)] shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-white/60">
          Raw JSON
        </span>
        <button
          onClick={copy}
          className="rounded-[var(--radius-control)] border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-white/20"
        >
          {copied ? "Copied" : "Copy JSON"}
        </button>
      </div>
      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-xs leading-6">{json}</pre>
    </div>
  );
}
