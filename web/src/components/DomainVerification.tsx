"use client";

import { useState } from "react";
import { ApiError, requestDomainChallenge, verifyDomain } from "@/lib/nanda-api";
import type { DomainChallenge, IndexRecord } from "@/lib/nanda-types";

// ── Copyable row ───────────────────────────────────────────────────────────────

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. non-secure context) — selection still works.
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white px-3 py-2">
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">{label}</p>
        <p className="truncate font-mono text-xs text-slate-900">{value}</p>
      </div>
      <button
        onClick={copy}
        className="shrink-0 rounded-lg border border-black/10 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

// ── Domain verification ─────────────────────────────────────────────────────────

/**
 * Proves ownership of an org's domain via a DNS TXT challenge.
 *
 * Flow: generate a challenge → the user publishes the TXT record at their DNS
 * host → "Check DNS" resolves it and, on success, activates the org. Mutations
 * require the admin role; the API returns 403 for non-admins, surfaced inline.
 */
export function DomainVerification({
  org,
  onVerified,
}: {
  org: IndexRecord;
  onVerified: (updated: IndexRecord) => void;
}) {
  const [challenge, setChallenge] = useState<DomainChallenge | null>(null);
  const [generating, setGenerating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (org.domain_verified) {
    return (
      <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white">
            ✓
          </span>
          <h3 className="text-sm font-semibold text-emerald-900">Domain ownership verified</h3>
        </div>
        <p className="mt-1.5 text-xs text-emerald-700">
          <span className="font-mono">{org.domain}</span> has been verified via DNS. Agents under
          this domain resolve through your registry.
        </p>
      </div>
    );
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      setChallenge(await requestDomainChallenge(org.org_id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate a challenge.");
    } finally {
      setGenerating(false);
    }
  }

  async function check() {
    setChecking(true);
    setError(null);
    try {
      onVerified(await verifyDomain(org.org_id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-amber-900">Verify domain ownership</h3>
        <p className="mt-1 text-xs text-amber-700">
          Your org stays <span className="font-semibold">pending</span> and hidden from the public
          index until you prove control of <span className="font-mono">{org.domain}</span> by adding
          a DNS TXT record.
        </p>
      </div>

      {challenge ? (
        <div className="space-y-3">
          <p className="text-xs text-amber-800">
            Add this TXT record at your DNS provider, then check below. DNS changes can take a few
            minutes (sometimes longer) to propagate.
          </p>
          <div className="space-y-2">
            <CopyRow label="Type" value={challenge.record_type} />
            <CopyRow label="Name / Host" value={challenge.record_name} />
            <CopyRow label="Value" value={challenge.record_value} />
          </div>
          <p className="text-[11px] text-amber-600">
            Challenge expires {new Date(challenge.expires_at).toLocaleString()}.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={check}
              disabled={checking}
              className="rounded-2xl bg-slate-950 px-5 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {checking ? "Checking DNS…" : "Check DNS now"}
            </button>
            <button
              onClick={generate}
              disabled={generating}
              className="rounded-2xl border border-amber-300 bg-white px-5 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60"
            >
              {generating ? "Regenerating…" : "Regenerate"}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={generate}
          disabled={generating}
          className="rounded-2xl bg-slate-950 px-5 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {generating ? "Generating…" : "Generate DNS record"}
        </button>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          {error}
        </div>
      )}
    </div>
  );
}
