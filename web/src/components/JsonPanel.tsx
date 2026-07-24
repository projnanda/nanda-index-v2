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
    <div className="min-w-0 rounded-card border border-line bg-brand-800 text-surface-light shadow-card">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <span className="brand-tag uppercase text-white/60">
          Raw JSON
        </span>
        <button
          onClick={copy}
          className="rounded-control border border-white/15 bg-surface-light/10 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-surface-light/20"
        >
          {copied ? "Copied" : "Copy JSON"}
        </button>
      </div>
      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-xs leading-6">{json}</pre>
    </div>
  );
}
