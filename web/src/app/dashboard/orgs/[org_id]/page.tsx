"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatTimestamp } from "@/lib/formatTimestamp";
import { useRouter, useParams } from "next/navigation";
import { OrgActionDialog, type OrgAction } from "@/components/OrgActionDialog";
import { FieldLabel } from "@/components/FieldLabel";
import { PageShell } from "@/components/PageShell";
import { StatusBadge } from "@/components/StatusBadge";
import { JsonPanel } from "@/components/JsonPanel";
import { DomainVerification } from "@/components/DomainVerification";
import { ApiError, getOrgAsOwner, updateOrg, suspendOrg, reactivateOrg, deleteOrg, resendVerification } from "@/lib/nanda-api";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { applyRuntimeSettings, readRuntimeSettings, RUNTIME_FIELDS, RUNTIME_PROVIDERS } from "@/lib/org-runtime-settings";
import { orgFormError, validateOrgFields, type OrgFieldErrors, type OrgFormField } from "@/lib/org-validation";
import { nandaField } from "@/lib/air";
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
  const [action, setAction] = useState<OrgAction | null>(null);
  const actionInFlight = useRef(false);
  const actionSucceeded = useRef(false);
  const actionFocusTarget = useRef<HTMLHeadingElement>(null);

  const [displayName, setDisplayName] = useState("");
  const [registryUrl, setRegistryUrl] = useState("");
  const [domain, setDomain] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [version, setVersion] = useState("");
  const [ttlSeconds, setTtlSeconds] = useState("86400");
  const advancedRef = useRef<HTMLDetailsElement>(null);
  const ttlRef = useRef<HTMLInputElement>(null);
  const runtimeUrlRef = useRef<HTMLInputElement>(null);
  const pendingAdvancedFocus = useRef<"ttl_seconds" | "runtime_url" | null>(null);
  const resolutionRole = org ? nandaField(org, "resolutionRole") : undefined;
  const originalRuntimeProvider = org ? nandaField(org, "runtime.provider") : undefined;
  const isAgentCard = resolutionRole === "smb-agent-card" || resolutionRole === "personal-agent-card";
  const [runtime, setRuntime] = useState(() => readRuntimeSettings({}));
  const [fieldErrors, setFieldErrors] = useState<OrgFieldErrors>({});
  const validation = validateOrgFields({ display_name: displayName, ...(org?.domain ? { domain } : {}),
    registry_url: registryUrl, description, tags, version, ...(isAgentCard ? { runtime_url: runtime["runtime.url"] } : {}), ttl_seconds: ttlSeconds },
    { allowEmptyRegistryUrl: !org?.registry_url });
  function showFieldErrors(errors: OrgFieldErrors) {
    pendingAdvancedFocus.current = errors.ttl_seconds ? "ttl_seconds" : isAgentCard && errors.runtime_url ? "runtime_url" : null;
    setFieldErrors(errors);
  }
  useEffect(() => {
    // A server response must unlock the fieldset before its invalid field can receive focus.
    if (saving || !pendingAdvancedFocus.current) return;
    if (advancedRef.current) advancedRef.current.open = true;
    const target = pendingAdvancedFocus.current === "ttl_seconds" ? ttlRef.current : runtimeUrlRef.current;
    pendingAdvancedFocus.current = null;
    target?.focus();
  }, [fieldErrors, saving]);
  function clearFieldError(field: OrgFormField) {
    setFieldErrors((errors) => ({ ...errors, [field]: undefined }));
  }
  function fieldProps(field: OrgFormField) {
    return { "aria-invalid": !!fieldErrors[field], "aria-describedby": fieldErrors[field] ? `${fid}-${field}-error` : undefined,
      onBlur: () => setFieldErrors((errors) => ({ ...errors, [field]: validation[field] })) };
  }
  function fieldError(field: OrgFormField) {
    return fieldErrors[field] ? <p id={`${fid}-${field}-error`} role="alert" className="mt-1 text-xs text-rose-700">{fieldErrors[field]}</p> : null;
  }

  useEffect(() => {
    if (action === null && actionSucceeded.current) {
      // The status change may remove the opener, so use a stable page target.
      actionFocusTarget.current?.focus();
      actionSucceeded.current = false;
    }
  }, [action]);

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
        setTtlSeconds(String(data.ttl_seconds));
        setRuntime(readRuntimeSettings(data.extensions));
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
    showFieldErrors(validation);
    if (Object.keys(validation).length) return;
    const ttl = Number(ttlSeconds);
    setSaving(true);
    try {
      const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
      // Personal entries have no domain; send it only when the org has one and it changed.
      const newDomain = domain.trim();
      const updated = await updateOrg(orgId, {
        display_name: displayName.trim(),
        ...(registryUrl.trim() ? { registry_url: registryUrl.trim() } : {}),
        ...(org?.domain && newDomain && newDomain !== org.domain ? { domain: newDomain } : {}),
        description: description || undefined,
        tags: tagList.length ? tagList : [],
        version: version || undefined,
        ttl_seconds: ttl,
        ...(isAgentCard ? { extensions: applyRuntimeSettings(org!.extensions, runtime) } : {}),
      });
      setOrg(updated);
      setEditing(false);
    } catch (err) {
      const failure = orgFormError(err);
      showFieldErrors(failure.fields);
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  async function onSuspend() {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setError(null);
    setSuspending(true);
    try {
      const updated = await suspendOrg(orgId);
      actionSucceeded.current = true;
      setOrg(updated);
      setAction(null);
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.status}: ${err.message}`);
      else setError(`Unexpected error: ${String(err)}`);
    } finally {
      actionInFlight.current = false;
      setSuspending(false);
    }
  }

  async function onReactivate() {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setError(null);
    setReactivating(true);
    try {
      const updated = await reactivateOrg(orgId);
      actionSucceeded.current = true;
      setOrg(updated);
      setAction(null);
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.status}: ${err.message}`);
      else setError(`Unexpected error: ${String(err)}`);
    } finally {
      actionInFlight.current = false;
      setReactivating(false);
    }
  }

  async function onDelete() {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setError(null);
    setDeleting(true);
    try {
      await deleteOrg(orgId);
      setAction(null);
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.status}: ${err.message}`);
      else setError(`Unexpected error: ${String(err)}`);
    } finally {
      actionInFlight.current = false;
      setDeleting(false);
    }
  }

  function beginEditing() {
    if (!org) return;
    setDisplayName(org.display_name);
    setRegistryUrl(org.registry_url ?? "");
    setDomain(org.domain ?? "");
    setDescription(org.description ?? "");
    setTags((org.tags ?? []).join(", "));
    setVersion(org.version ?? "");
    setTtlSeconds(String(org.ttl_seconds));
    setRuntime(readRuntimeSettings(org.extensions));
    pendingAdvancedFocus.current = null;
    setError(null);
    setFieldErrors({});
    setEditing(true);
  }

  const inputCls = "w-full rounded-2xl border border-black/10 px-4 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-slate-300 aria-invalid:border-rose-300";

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
          <fieldset disabled={saving} className="min-w-0 rounded-3xl border border-black/10 bg-white p-5 shadow-sm space-y-4">
            <div>
              <FieldLabel htmlFor={`${fid}-display-name`} label="Display Name" info={ORG_FIELD_HELP.display_name} />
              <input id={`${fid}-display-name`} {...fieldProps("display_name")} value={displayName} onChange={(e) => { setDisplayName(e.target.value); clearFieldError("display_name"); }} className={inputCls} />
              {fieldError("display_name")}
            </div>
            {org.domain && (
              <div>
                <FieldLabel htmlFor={`${fid}-domain`} label="Domain" info={ORG_FIELD_HELP.domain} />
                <input id={`${fid}-domain`} {...fieldProps("domain")} value={domain} onChange={(e) => { setDomain(e.target.value); clearFieldError("domain"); }} className={inputCls} />
              {fieldError("domain")}
              </div>
            )}
            <div>
              <FieldLabel htmlFor={`${fid}-url`} label="Catalog / Agent Card URL" info={ORG_FIELD_HELP.registry_url} />
              <input id={`${fid}-url`} {...fieldProps("registry_url")} value={registryUrl} onChange={(e) => { setRegistryUrl(e.target.value); clearFieldError("registry_url"); }} className={inputCls} placeholder="https://catalog.example.com" />
              {fieldError("registry_url")}
            </div>
            <div>
              <FieldLabel htmlFor={`${fid}-description`} label="Description" info={ORG_FIELD_HELP.description} optional />
              <textarea id={`${fid}-description`} {...fieldProps("description")} value={description} onChange={(e) => { setDescription(e.target.value); clearFieldError("description"); }} rows={3} className={`${inputCls} resize-none`} placeholder="Describe your registry or agent catalog." />
              {fieldError("description")}
            </div>
            <div>
              <FieldLabel htmlFor={`${fid}-tags`} label="Tags" info={ORG_FIELD_HELP.tags} optional />
              <input id={`${fid}-tags`} {...fieldProps("tags")} value={tags} onChange={(e) => { setTags(e.target.value); clearFieldError("tags"); }} className={inputCls} placeholder="enterprise, payments, ai-catalog" />
              {fieldError("tags")}
              <p className="mt-1 text-[11px] text-slate-400">Separate tags with commas.</p>
            </div>
            <div>
              <FieldLabel htmlFor={`${fid}-version`} label="Version label" info={ORG_FIELD_HELP.version} optional />
              <input id={`${fid}-version`} {...fieldProps("version")} value={version} onChange={(e) => { setVersion(e.target.value); clearFieldError("version"); }} className={inputCls} placeholder="v1.0.0" />
              {fieldError("version")}
              <p className="mt-1 text-[11px] text-slate-400">Optional version label, up to 64 characters (for example, v1.0.0 or 2026-10).</p>
            </div>
            <details ref={advancedRef} className="space-y-4 rounded-2xl border border-black/10 p-4">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">Advanced settings</summary>
              <div>
                <FieldLabel htmlFor={`${fid}-ttl`} label="Cache TTL" info={ORG_FIELD_HELP.ttl_seconds} />
                <input ref={ttlRef} id={`${fid}-ttl`} {...fieldProps("ttl_seconds")} type="number" min={3600} max={604800} step={1} value={ttlSeconds}
                  onChange={(e) => { setTtlSeconds(e.target.value); clearFieldError("ttl_seconds"); }} className={inputCls} />
                {fieldError("ttl_seconds")}
                <p className="mt-1 text-xs text-slate-500">Seconds, from 3600 (1 hour) to 604800 (7 days).</p>
              </div>
              {isAgentCard && (
                <>
                  <p className="text-xs text-slate-500">Runtime and authentication fields are public hints. Do not enter passwords, tokens or other credentials.</p>
                  {RUNTIME_FIELDS.map(({ key, label, help }) => (
                    <div key={key}>
                      <FieldLabel htmlFor={`${fid}-${key}`} label={label} info={ORG_FIELD_HELP[help]} optional />
                      {key === "runtime.provider" ? (
                        <select id={`${fid}-${key}`} value={runtime[key]} className={inputCls}
                          onChange={(e) => setRuntime((current) => ({ ...current, [key]: e.target.value }))}>
                          <option value="">Select provider…</option>
                          {originalRuntimeProvider && !RUNTIME_PROVIDERS.includes(originalRuntimeProvider) && <option value={originalRuntimeProvider}>{originalRuntimeProvider}</option>}
                          {RUNTIME_PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
                        </select>
                      ) : (
                        <input ref={key === "runtime.url" ? runtimeUrlRef : undefined} id={`${fid}-${key}`} {...(key === "runtime.url" ? fieldProps("runtime_url") : {})} value={runtime[key]} className={inputCls}
                          onChange={(e) => { setRuntime((current) => ({ ...current, [key]: e.target.value })); if (key === "runtime.url") clearFieldError("runtime_url"); }} />
                      )}
                      {key === "runtime.url" && fieldError("runtime_url")}
                    </div>
                  ))}
                </>
              )}
            </details>
            <div className="flex gap-3">
              <button onClick={onSave} disabled={saving} className="rounded-2xl bg-slate-950 px-6 py-2.5 text-sm font-medium text-white disabled:opacity-60">
                {saving ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setEditing(false)} className="rounded-2xl border border-black/10 bg-white px-6 py-2.5 text-sm font-medium text-slate-700">
                Cancel
              </button>
            </div>
          </fieldset>
        ) : (
          <div className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{org.display_name}</h2>
              <button onClick={beginEditing} className="rounded-2xl border border-black/10 px-4 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
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

        {error && !action && (
          <div role="alert" className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
        )}

        {action && <OrgActionDialog action={action} orgId={orgId} domain={org.domain}
          busy={suspending || reactivating || deleting} error={error}
          onCancel={() => { if (!actionInFlight.current) { setAction(null); setError(null); } }}
          onConfirm={action === "suspend" ? onSuspend : action === "reactivate" ? onReactivate : onDelete} />}

        <JsonPanel data={org} />

        <div className="rounded-3xl border border-rose-100 bg-rose-50 p-5 space-y-3">
          <h3 ref={actionFocusTarget} tabIndex={-1} className="text-sm font-semibold text-rose-800">Danger Zone</h3>
          {org.status === "suspended" ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-rose-700">This organization is suspended and hidden from the public index.</p>
              <button
                onClick={() => { setError(null); setAction("reactivate"); }}
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
                onClick={() => { setError(null); setAction("suspend"); }}
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
              onClick={() => { setError(null); setAction("delete"); }}
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
