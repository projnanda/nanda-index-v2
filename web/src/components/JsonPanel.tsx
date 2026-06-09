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
    <div className="min-w-0 rounded-3xl border border-black/10 bg-slate-950 text-slate-100 shadow-sm">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
          Raw JSON
        </span>
        <button
          onClick={copy}
          className="rounded-lg border border-white/15 px-3 py-1.5 text-xs hover:bg-white/10"
        >
          {copied ? "Copied" : "Copy JSON"}
        </button>
      </div>
      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all p-4 text-xs leading-6">{json}</pre>
    </div>
  );
}