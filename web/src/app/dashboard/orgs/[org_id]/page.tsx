"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { StatusBadge } from "@/components/StatusBadge";
import { JsonPanel } from "@/components/JsonPanel";
import { DomainVerification } from "@/components/DomainVerification";
import { ApiError, getOrgAsOwner, updateOrg, suspendOrg, reactivateOrg, deleteOrg } from "@/lib/nanda-api";
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
  const [reactivating, setReactivating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [registryUrl, setRegistryUrl] = useState("");
  const [domain, setDomain] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [version, setVersion] = useState("");

  useEffect(() => {
    let cancelled = false;

    getOrgAsOwner(orgId)
      .then((data) => {
        if (cancelled) return;
        setOrg(data);
        setDisplayName(data.display_name);
        setRegistryUrl(data.registry_url ?? "");
        setDomain(data.domain ?? "");
        setDescription(data.description ?? "");
        setTags((data.tags ?? []).join(", "));
        setVersion(data.version ?? "");
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
      const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
      const updated = await updateOrg(orgId, {
        display_name: displayName,
        registry_url: registryUrl || null,
        domain,
        description: description || undefined,
        tags: tagList.length ? tagList : [],
        version: version || undefined,
      });
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
    if (!confirm(`Suspend "${orgId}"? This will remove it from public index results.`)) return;
    setSuspending(true);
    try {
      const updated = await suspendOrg(orgId);
      setOrg(updated);
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.status}: ${err.message}`);
      else setError(`Unexpected error: ${String(err)}`);
    } finally {
      setSuspending(false);
    }
  }

  async function onReactivate() {
    if (!confirm(`Reactivate "${orgId}"? This will make it active and visible in the index again.`)) return;
    setReactivating(true);
    try {
      const updated = await reactivateOrg(orgId);
      setOrg(updated);
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.status}: ${err.message}`);
      else setError(`Unexpected error: ${String(err)}`);
    } finally {
      setReactivating(false);
    }
  }

  async function onDelete() {
    if (!confirm(`Permanently delete "${orgId}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteOrg(orgId);
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.status}: ${err.message}`);
      else setError(`Unexpected error: ${String(err)}`);
    } finally {
      setDeleting(false);
    }
  }

  const inputCls = "w-full rounded-2xl border border-black/10 px-4 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-slate-300";
  const labelCls = "mb-1 block text-xs font-medium uppercase tracking-[0.16em] text-slate-500";

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
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={org.status} />
          {org.domain_verified ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-0.5 text-xs font-medium text-emerald-700">
              Domain verified
            </span>
          ) : (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-0.5 text-xs font-medium text-amber-700">
              Domain not verified
            </span>
          )}
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

        <DomainVerification org={org} onVerified={setOrg} />

        {editing ? (
          <div className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm space-y-4">
            <label className="block">
              <span className={labelCls}>Display Name</span>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} />
            </label>
            <label className="block">
              <span className={labelCls}>Domain</span>
              <input value={domain} onChange={(e) => setDomain(e.target.value)} className={inputCls} />
            </label>
            <label className="block">
              <span className={labelCls}>Catalog / Agent Card URL</span>
              <input value={registryUrl} onChange={(e) => setRegistryUrl(e.target.value)} className={inputCls} placeholder="https://catalog.example.com" />
            </label>
            <label className="block">
              <span className={labelCls}>Description (optional)</span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={`${inputCls} resize-none`} placeholder="Describe your registry or agent catalog." />
            </label>
            <label className="block">
              <span className={labelCls}>Tags (optional, comma-separated)</span>
              <input value={tags} onChange={(e) => setTags(e.target.value)} className={inputCls} placeholder="enterprise, payments, ai-catalog" />
              <p className="mt-1 text-[11px] text-slate-400">Separate tags with commas.</p>
            </label>
            <label className="block">
              <span className={labelCls}>Version (optional)</span>
              <input value={version} onChange={(e) => setVersion(e.target.value)} className={inputCls} placeholder="v1.0.0" />
              <p className="mt-1 text-[11px] text-slate-400">SemVer of this artifact (shown on the card).</p>
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
                <span className="font-medium">Catalog URL:</span>{" "}
                {org.registry_url ? (
                  <a href={org.registry_url} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-xs text-indigo-600 hover:underline">{org.registry_url}</a>
                ) : (
                  <span className="text-slate-400 italic">—</span>
                )}
              </div>
              {org.description && (
                <div><span className="font-medium">Description:</span> {org.description}</div>
              )}
              {org.tags && org.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="font-medium">Tags:</span>
                  {org.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-mono text-slate-600">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <div><span className="font-medium">TTL:</span> {org.ttl_seconds}s</div>
              <div><span className="font-medium">Created:</span> {new Date(org.created_at).toLocaleString()}</div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
        )}

        <JsonPanel data={org} />

        <div className="rounded-3xl border border-rose-100 bg-rose-50 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-rose-800">Danger Zone</h3>
          {org.status === "suspended" ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-rose-700">This organization is suspended and hidden from the public index.</p>
              <button
                onClick={onReactivate}
                disabled={reactivating}
                className="ml-4 shrink-0 rounded-2xl border border-emerald-300 bg-white px-5 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
              >
                {reactivating ? "Reactivating…" : "Reactivate"}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-rose-700">Suspending removes this org from public index results. You can reactivate it later.</p>
              <button
                onClick={onSuspend}
                disabled={suspending}
                className="ml-4 shrink-0 rounded-2xl border border-rose-300 bg-white px-5 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60"
              >
                {suspending ? "Suspending…" : "Suspend"}
              </button>
            </div>
          )}
          <div className="border-t border-rose-200 pt-3 flex items-center justify-between">
            <p className="text-sm text-rose-700">Permanently delete this organization and all its data. This cannot be undone.</p>
            <button
              onClick={onDelete}
              disabled={deleting}
              className="ml-4 shrink-0 rounded-2xl bg-rose-600 px-5 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
