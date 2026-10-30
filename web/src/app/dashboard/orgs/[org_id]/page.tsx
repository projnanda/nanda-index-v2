"use client";

import { formatTimestamp } from "@/lib/formatTimestamp";

import { useEffect, useId, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { FieldLabel } from "@/components/FieldLabel";
import { PageShell } from "@/components/PageShell";
import { StatusBadge } from "@/components/StatusBadge";
import { JsonPanel } from "@/components/JsonPanel";
import { DomainVerification } from "@/components/DomainVerification";
import { ApiError, getOrgAsOwner, updateOrg, suspendOrg, reactivateOrg, deleteOrg, resendVerification } from "@/lib/nanda-api";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { ORG_FIELD_HELP } from "@/lib/org-field-help";
import type { IndexRecord, Moderation } from "@/lib/nanda-types";

const MODERATION_MESSAGES: Record<Exclude<Moderation, "none">, string> = {
  hidden:
    "An index operator has hidden this entry: it no longer appears in listings or search, but it still resolves by its exact identifier.",
  takedown:
    "An index operator has taken this entry down: it is not listed or resolvable, and it cannot be reactivated from here. Contact the NANDA Index operators to have it reviewed.",
};

/** Explains operator moderation to the owner — set by operators, not editable here. */
function ModerationNotice({ moderation }: { moderation: Exclude<Moderation, "none"> }) {
  return (
    <div role="status" className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
      {MODERATION_MESSAGES[moderation]}
    </div>
  );
}

export default function OrgDetailPage() {
  useRequireAuth();
  const router = useRouter();
  const params = useParams<{ org_id: string }>();
  const orgId = params.org_id;
  const fid = useId();

  const [org, setOrg] = useState<IndexRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

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

  async function onResend() {
    setResending(true);
    setError(null);
    try {
      await resendVerification(orgId);
      setResent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the email. Please try again.");
    } finally {
      setResending(false);
    }
  }

  async function onSave() {
    setError(null);
    setSaving(true);
    try {
      const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
      // Personal entries have no domain; send it only when the org has one and it changed.
      const newDomain = domain.trim();
      const updated = await updateOrg(orgId, {
        display_name: displayName,
        registry_url: registryUrl || null,
        ...(org?.domain && newDomain && newDomain !== org.domain ? { domain: newDomain } : {}),
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

  if (loading) {
    return <PageShell title={orgId} description="Loading…"><div className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm text-sm text-slate-400">Loading…</div></PageShell>;
  }

  // Full-page error only when the org could not be loaded; errors from actions
  // (save, suspend, …) are shown inline below so the page stays usable.
  if (!org) {
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
        {org.moderation && org.moderation !== "none" && <ModerationNotice moderation={org.moderation} />}
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={org.status} />
          {org.domain && (
            org.domain_verified ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-0.5 text-xs font-medium text-emerald-700">
                Domain verified
              </span>
            ) : (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-0.5 text-xs font-medium text-amber-700">
                Domain not verified
              </span>
            )
          )}
          {org.email_verified ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-0.5 text-xs font-medium text-emerald-700">
              Email verified
            </span>
          ) : (
            <>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-0.5 text-xs font-medium text-amber-700">
                Email not verified — check your inbox
              </span>
              <button
                onClick={onResend}
                disabled={resending || resent}
                className="rounded-full border border-amber-300 bg-white px-3 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-60"
              >
                {resent ? "Email sent" : resending ? "Sending…" : "Resend email"}
              </button>
            </>
          )}
        </div>

        {/* Keyed by domain: a domain change resets the panel, so it never shows
            the previous domain's DNS record. */}
        {org.domain && <DomainVerification key={org.domain} org={org} onVerified={setOrg} />}

        {editing ? (
          <div className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm space-y-4">
            <div>
              <FieldLabel htmlFor={`${fid}-display-name`} label="Display Name" info={ORG_FIELD_HELP.display_name} />
              <input id={`${fid}-display-name`} value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} />
            </div>
            {org.domain && (
              <div>
                <FieldLabel htmlFor={`${fid}-domain`} label="Domain" info={ORG_FIELD_HELP.domain} />
                <input id={`${fid}-domain`} value={domain} onChange={(e) => setDomain(e.target.value)} className={inputCls} />
              </div>
            )}
            <div>
              <FieldLabel htmlFor={`${fid}-url`} label="Catalog / Agent Card URL" info={ORG_FIELD_HELP.registry_url} />
              <input id={`${fid}-url`} value={registryUrl} onChange={(e) => setRegistryUrl(e.target.value)} className={inputCls} placeholder="https://catalog.example.com" />
            </div>
            <div>
              <FieldLabel htmlFor={`${fid}-description`} label="Description" info={ORG_FIELD_HELP.description} optional />
              <textarea id={`${fid}-description`} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={`${inputCls} resize-none`} placeholder="Describe your registry or agent catalog." />
            </div>
            <div>
              <FieldLabel htmlFor={`${fid}-tags`} label="Tags" info={ORG_FIELD_HELP.tags} optional />
              <input id={`${fid}-tags`} value={tags} onChange={(e) => setTags(e.target.value)} className={inputCls} placeholder="enterprise, payments, ai-catalog" />
              <p className="mt-1 text-[11px] text-slate-400">Separate tags with commas.</p>
            </div>
            <div>
              <FieldLabel htmlFor={`${fid}-version`} label="Version label" info={ORG_FIELD_HELP.version} optional />
              <input id={`${fid}-version`} value={version} onChange={(e) => setVersion(e.target.value)} className={inputCls} placeholder="v1.0.0" />
              <p className="mt-1 text-[11px] text-slate-400">Optional version label, up to 64 characters (for example, v1.0.0 or 2026-10).</p>
            </div>
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
              {org.domain && <div><span className="font-medium">Domain:</span> {org.domain}</div>}
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
              <div><span className="font-medium">Created:</span> {formatTimestamp(org.created_at)}</div>
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
          ) : org.status === "pending" ? (
            <p className="text-sm text-rose-700">
              This organization is not public yet — it appears in the index once ownership is verified.
            </p>
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
