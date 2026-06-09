"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { StatusBadge } from "@/components/StatusBadge";
import { JsonPanel } from "@/components/JsonPanel";
import { ApiError, getOrgAsOwner, updateOrg, deleteOrg } from "@/lib/nanda-api";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import type { IndexRecord } from "@/lib/nanda-types";

export default function OrgDetailPage() {
  useRequireAuth();
  const router = useRouter();
  const params = useParams<{ org_id: string }>();
  const orgId = params.org_id;

  const [org, setOrg] = useState<IndexRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [suspending, setSuspending] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [registryUrl, setRegistryUrl] = useState("");
  const [domain, setDomain] = useState("");

  useEffect(() => {
    let cancelled = false;

    getOrgAsOwner(orgId)
      .then((data) => {
        if (cancelled) return;
        setOrg(data);
        setDisplayName(data.display_name);
        setRegistryUrl(data.registry_url);
        setDomain(data.domain);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load org.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [orgId]);

  async function onSave() {
    setSaving(true);
    try {
      const updated = await updateOrg(orgId, { display_name: displayName, registry_url: registryUrl, domain });
      setOrg(updated);
      setEditing(false);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof TypeError && (err as TypeError).message.includes("fetch")) {
        setError("Cannot reach the server — make sure the backend is running on port 3001.");
      } else {
        setError("Save failed. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function onSuspend() {
    if (!confirm(`Suspend "${orgId}"? This will deactivate the index record.`)) return;
    setSuspending(true);
    try {
      await deleteOrg(orgId);
      router.replace("/dashboard");
    } catch (err) {
      console.error("[onSuspend] error:", err);
      if (err instanceof ApiError) {
        setError(`${err.status}: ${err.message}`);
      } else if (err instanceof TypeError) {
        setError(`Network error — ${(err as TypeError).message}. Make sure the backend is running on port 3001.`);
      } else {
        setError(`Unexpected error: ${String(err)}`);
      }
    } finally {
      setSuspending(false);
    }
  }

  if (loading) {
    return <PageShell title={orgId} description="Loading…"><div className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm text-sm text-slate-400">Loading…</div></PageShell>;
  }

  if (error || !org) {
    return (
      <PageShell title={orgId} description="">
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
          {error ?? "Not found or access denied."}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title={org.display_name} description={`org_id: ${org.org_id}`}>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <StatusBadge status={org.status} />
          {org.email_verified ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-0.5 text-xs font-medium text-emerald-700">
              Email verified
            </span>
          ) : (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-0.5 text-xs font-medium text-amber-700">
              Email not verified — check your inbox
            </span>
          )}
        </div>

        {editing ? (
          <div className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Display Name</span>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full rounded-2xl border border-black/10 px-4 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-slate-300" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Domain</span>
              <input value={domain} onChange={(e) => setDomain(e.target.value)} className="w-full rounded-2xl border border-black/10 px-4 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-slate-300" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Registry URL</span>
              <input value={registryUrl} onChange={(e) => setRegistryUrl(e.target.value)} className="w-full rounded-2xl border border-black/10 px-4 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-slate-300" />
            </label>
            <div className="flex gap-3">
              <button onClick={onSave} disabled={saving} className="rounded-2xl bg-slate-950 px-6 py-2.5 text-sm font-medium text-white disabled:opacity-60">
                {saving ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setEditing(false)} className="rounded-2xl border border-black/10 bg-white px-6 py-2.5 text-sm font-medium text-slate-700">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{org.display_name}</h2>
              <button onClick={() => setEditing(true)} className="rounded-2xl border border-black/10 px-4 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                Edit
              </button>
            </div>
            <div className="grid gap-2 text-sm text-slate-700">
              <div><span className="font-medium">Domain:</span> {org.domain}</div>
              <div>
                <span className="font-medium">Registry URL:</span>{" "}
                <a href={org.registry_url} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-xs text-indigo-600 hover:underline">{org.registry_url}</a>
              </div>
              <div><span className="font-medium">TTL:</span> {org.ttl_seconds}s</div>
              <div><span className="font-medium">Created:</span> {new Date(org.created_at).toLocaleString()}</div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
        )}

        <JsonPanel data={org} />

        <div className="rounded-3xl border border-rose-100 bg-rose-50 p-5">
          <h3 className="mb-2 text-sm font-semibold text-rose-800">Danger Zone</h3>
          <p className="mb-4 text-sm text-rose-700">Suspending this organization will set its status to &ldquo;suspended&rdquo; and remove it from public index results.</p>
          <button
            onClick={onSuspend}
            disabled={suspending}
            className="rounded-2xl border border-rose-300 bg-white px-5 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60"
          >
            {suspending ? "Suspending…" : "Suspend organization"}
          </button>
        </div>
      </div>
    </PageShell>
  );
}
