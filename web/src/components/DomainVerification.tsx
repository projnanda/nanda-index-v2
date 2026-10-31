"use client";

import { formatTimestamp } from "@/lib/formatTimestamp";

import { useEffect, useState } from "react";
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

/** The API's machine-readable error code (e.g. "NO_ACTIVE_CHALLENGE"), if any. */
function apiErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const payload = err.payload as { error?: unknown } | null | undefined;
  return typeof payload?.error === "string" ? payload.error : null;
}

/** The record name relative to the zone — what a provider's "Host" field expects. */
function hostLabel(recordName: string, domain: string): string {
  const suffix = `.${domain}`;
  return recordName.endsWith(suffix) ? recordName.slice(0, -suffix.length) : recordName;
}

/**
 * Proves ownership of an org's domain via a DNS TXT challenge.
 *
 * Flow: load the challenge → the user publishes the TXT record at their DNS
 * host → "Check DNS" resolves it and, on success, activates the org. The server
 * returns the same challenge until it expires, so it is loaded on mount and
 * survives reloads. Only admins may see the challenge; members get a 403, shown
 * as a plain note rather than an error. Remount (key on the domain) when the
 * domain changes so a challenge for the old domain is not shown.
 */
export function DomainVerification({
  org,
  onVerified,
}: {
  org: IndexRecord;
  onVerified: (updated: IndexRecord) => void;
}) {
  const needsChallenge = Boolean(org.domain) && !org.domain_verified;
  const [challenge, setChallenge] = useState<DomainChallenge | null>(null);
  const [loading, setLoading] = useState(needsChallenge);
  const [adminOnly, setAdminOnly] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped to (re)load the challenge — e.g. after a failed load or an expiry.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!needsChallenge) return;
    let cancelled = false;

    requestDomainChallenge(org.org_id)
      .then((data) => { if (!cancelled) setChallenge(data); })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) setAdminOnly(true);
        else setError(err instanceof ApiError ? err.message : "Could not load the DNS record.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [org.org_id, needsChallenge, attempt]);

  if (!org.domain) {
    return null;
  }

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

  function reload() {
    setChallenge(null);
    setLoading(true);
    setAttempt((n) => n + 1);
  }

  async function check() {
    setChecking(true);
    setError(null);
    try {
      onVerified(await verifyDomain(org.org_id));
    } catch (err) {
      if (apiErrorCode(err) === "NO_ACTIVE_CHALLENGE") {
        // The shown record expired; fetch its replacement for the user to publish.
        reload();
        setError("That record expired. Replace the TXT value at your DNS provider with the new one below, then check again.");
      } else {
        setError(err instanceof ApiError ? err.message : "Verification failed.");
      }
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

      {adminOnly ? (
        <p className="text-xs text-amber-800">
          Only org admins can view the DNS record and verify the domain.
        </p>
      ) : loading ? (
        <p className="text-xs text-amber-700">Loading DNS record…</p>
      ) : challenge ? (
        <div className="space-y-3">
          <p className="text-xs text-amber-800">
            Add this TXT record at your DNS provider, then check below. DNS changes can take a few
            minutes (sometimes longer) to propagate.
          </p>
          <div className="space-y-2">
            <CopyRow label="Type" value={challenge.record_type} />
            <CopyRow label="Name" value={challenge.record_name} />
            <CopyRow label="Host" value={hostLabel(challenge.record_name, challenge.domain)} />
            <CopyRow label="Value" value={challenge.record_value} />
          </div>
          <p className="text-[11px] text-amber-700">
            Most DNS providers (Namecheap, GoDaddy, Cloudflare…) add your domain automatically — enter
            only the <span className="font-semibold">Host</span> value, or the record ends up at{" "}
            <span className="font-mono">{challenge.record_name}.{challenge.domain}</span>.
          </p>
          <p className="text-[11px] text-amber-600">
            This record stays the same until {formatTimestamp(challenge.expires_at)} —
            you can leave and come back to check.
          </p>
          <button
            onClick={check}
            disabled={checking}
            className="rounded-2xl bg-slate-950 px-5 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {checking ? "Checking DNS…" : "Check DNS now"}
          </button>
        </div>
      ) : (
        <button
          onClick={() => { setError(null); reload(); }}
          className="rounded-2xl bg-slate-950 px-5 py-2 text-sm font-medium text-white"
        >
          Get DNS record
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
