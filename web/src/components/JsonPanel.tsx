"use client";

import { useState } from "react";
import { PERSONAL_DATA_CLASS } from "@/lib/analyticsPrivacy";
import { prettyJson } from "@/lib/utils";

/** `mask` hides the JSON from session replays: set it when the data repeats what the visitor typed. */
export function JsonPanel({ data, mask = false }: { data: unknown; mask?: boolean }) {
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
        <span className="text-xs font-bold uppercase tracking-wide text-white/60">
          Raw JSON
        </span>
        <button
          onClick={copy}
          className="rounded-control border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-white/20"
        >
          {copied ? "Copied" : "Copy JSON"}
        </button>
      </div>
      <pre className={`${mask ? `${PERSONAL_DATA_CLASS} ` : ""}max-h-[60vh] overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-xs leading-6`}>{json}</pre>
    </div>
  );
}
