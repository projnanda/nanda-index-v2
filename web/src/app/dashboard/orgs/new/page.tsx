"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { ApiError, createOrg } from "@/lib/nanda-api";
import { cn } from "@/lib/utils";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import type { IndexRecord } from "@/lib/nanda-types";

// ── Types ────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

interface FormState {
  org_id: string;
  display_name: string;
  domain: string;
  registry_url: string;
  contact_email: string;
  ttl_seconds: string;
}

const EMPTY: FormState = {
  org_id: "",
  display_name: "",
  domain: "",
  registry_url: "",
  contact_email: "",
  ttl_seconds: "86400",
};

const TTL_OPTIONS = [
  { label: "1 hour", value: "3600" },
  { label: "6 hours", value: "21600" },
  { label: "24 hours (recommended)", value: "86400" },
  { label: "7 days", value: "604800" },
];

const ORG_ID_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$|^[a-z0-9]$/;

// ── Validation ────────────────────────────────────────────────────────────────

function validateStep1(form: FormState): Record<string, string> {
  const e: Record<string, string> = {};
  if (!form.org_id) {
    e.org_id = "Required.";
  } else if (!ORG_ID_RE.test(form.org_id)) {
    e.org_id = "Lowercase letters, numbers, hyphens only. Cannot start or end with a hyphen.";
  } else if (form.org_id.length > 64) {
    e.org_id = "Max 64 characters.";
  }
  if (!form.display_name) e.display_name = "Required.";
  if (!form.domain) {
    e.domain = "Required.";
  } else if (!/^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(form.domain)) {
    e.domain = "Enter a valid domain (e.g., nasiko.com).";
  }
  return e;
}

function validateStep2(form: FormState): Record<string, string> {
  const e: Record<string, string> = {};
  if (!form.registry_url) {
    e.registry_url = "Required.";
  } else if (!/^https?:\/\/.+/.test(form.registry_url)) {
    e.registry_url = "Must start with https:// (or http:// in development).";
  }
  if (!form.contact_email) {
    e.contact_email = "Required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact_email)) {
    e.contact_email = "Enter a valid email address.";
  }
  return e;
}

// ── Shared Field ──────────────────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  type = "text",
  hint,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  type?: string;
  hint?: string;
  error?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className={cn(
          "w-full rounded-2xl border px-4 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-slate-300 bg-white transition",
          error ? "border-rose-300 bg-rose-50/40" : "border-black/10",
        )}
      />
      {error ? (
        <p className="mt-1 text-[11px] text-rose-500">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
      ) : null}
    </label>
  );
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const steps: { label: string; step: Step }[] = [
    { label: "Identity", step: 1 },
    { label: "Registry", step: 2 },
    { label: "Review", step: 3 },
  ];

  return (
    <div className="mb-8 flex items-start justify-center">
      {steps.map(({ label, step }, i) => {
        const done = step < current;
        const active = step === current;
        return (
          <div key={label} className="flex items-center">
            {i > 0 && (
              <div
                className={cn(
                  "mb-5 h-px w-14",
                  done ? "bg-slate-950" : "bg-black/10",
                )}
              />
            )}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition",
                  active
                    ? "bg-slate-950 text-white shadow-md"
                    : done
                      ? "bg-emerald-500 text-white"
                      : "border-2 border-black/10 bg-white text-slate-400",
                )}
              >
                {done ? "✓" : step}
              </div>
              <span
                className={cn(
                  "hidden text-[10px] font-medium uppercase tracking-[0.14em] sm:block",
                  active
                    ? "text-slate-950"
                    : done
                      ? "text-emerald-600"
                      : "text-slate-400",
                )}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Success screen ────────────────────────────────────────────────────────────

function SuccessScreen({ record }: { record: IndexRecord }) {
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-7 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white text-xl font-bold">
          ✓
        </div>
        <h2 className="font-serif text-2xl italic text-emerald-900">Registry registered</h2>
        <p className="mt-1 font-mono text-sm text-emerald-700">{record.org_id}</p>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
        <p className="text-sm font-semibold text-amber-800">Check your email</p>
        <p className="mt-0.5 text-xs text-amber-700">
          Your record is <span className="font-semibold">pending</span> until you verify ownership via the link sent to your contact email.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/rap"
          className="flex flex-col rounded-2xl border border-black/10 bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-sm"
        >
          <span className="text-sm font-semibold text-slate-950">Add agents →</span>
          <span className="mt-0.5 text-xs text-slate-500">
            Open Registry Manager to register your first agent.
          </span>
        </Link>
        <Link
          href={`/dashboard/orgs/${record.org_id}`}
          className="flex flex-col rounded-2xl border border-black/10 bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-sm"
        >
          <span className="text-sm font-semibold text-slate-950">View org →</span>
          <span className="mt-0.5 text-xs text-slate-500">
            See your org record and edit settings.
          </span>
        </Link>
      </div>

      <p className="text-center">
        <Link href="/dashboard" className="text-xs text-slate-400 hover:text-slate-700">
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NewOrgPage() {
  useRequireAuth();
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [step, setStep] = useState<Step>(1);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [created, setCreated] = useState<IndexRecord | null>(null);

  const patch = (key: keyof FormState, val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  const touch = (...keys: string[]) =>
    setTouched((t) => Object.fromEntries([...Object.entries(t), ...keys.map((k) => [k, true])]));

  const s1Errors = validateStep1(form);
  const s2Errors = validateStep2(form);
  const allErrors = { ...s1Errors, ...s2Errors };
  const visible = (key: string) => (touched[key] ? allErrors[key] : undefined);

  const showPreview =
    form.org_id &&
    !s1Errors.org_id &&
    form.domain &&
    !s1Errors.domain;

  function advanceTo2() {
    touch("org_id", "display_name", "domain");
    if (!s1Errors.org_id && !s1Errors.display_name && !s1Errors.domain) setStep(2);
  }

  function advanceTo3() {
    touch("registry_url", "contact_email");
    if (!s2Errors.registry_url && !s2Errors.contact_email) setStep(3);
  }

  async function submit() {
    setSaving(true);
    setApiError(null);
    try {
      const record = await createOrg({
        org_id: form.org_id,
        display_name: form.display_name,
        domain: form.domain,
        contact_email: form.contact_email,
        registry_url: form.registry_url,
        ttl_seconds: parseInt(form.ttl_seconds, 10) || 86400,
      });
      setCreated(record);
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : "Registration failed.");
    } finally {
      setSaving(false);
    }
  }

  if (created) {
    return (
      <PageShell title="Registry Registered" description="">
        <SuccessScreen record={created} />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Register a Registry"
      description="Create your organization's index record in the NANDA Index."
    >
      <StepIndicator current={step} />

      {/* ── Step 1: Identity ──────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="mx-auto max-w-lg space-y-5">
          <div className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm space-y-4">
            <div>
              <h2 className="font-serif text-xl italic text-slate-950">Identity</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Choose a permanent identifier for your organization.
              </p>
            </div>

            <Field
              label="Org ID"
              value={form.org_id}
              onChange={(v) => patch("org_id", v)}
              onBlur={() => touch("org_id")}
              placeholder="nasiko"
              hint="Lowercase letters, numbers, hyphens. Permanent — cannot be changed later."
              error={visible("org_id")}
            />

            {showPreview && (
              <div className="rounded-2xl border border-black/5 bg-slate-50 px-4 py-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">
                  Locator preview
                </p>
                <p className="mt-1 font-mono text-sm text-slate-700">
                  <span className="text-slate-400">agent@</span>
                  <span className="text-slate-950">{form.domain}</span>
                  <span className="text-slate-400">:global</span>
                </p>
              </div>
            )}

            <Field
              label="Display Name"
              value={form.display_name}
              onChange={(v) => patch("display_name", v)}
              onBlur={() => touch("display_name")}
              placeholder="Nasiko Inc"
              error={visible("display_name")}
            />

            <Field
              label="Domain"
              value={form.domain}
              onChange={(v) => patch("domain", v)}
              onBlur={() => touch("domain")}
              placeholder="nasiko.com"
              hint="Agents will be addressable under this domain."
              error={visible("domain")}
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={advanceTo2}
              className="rounded-2xl bg-slate-950 px-6 py-3 text-sm font-medium text-white"
            >
              Continue →
            </button>
            <button
              onClick={() => router.back()}
              className="rounded-2xl border border-black/10 bg-white px-6 py-3 text-sm font-medium text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Registry & contact ───────────────────────────────────── */}
      {step === 2 && (
        <div className="mx-auto max-w-lg space-y-5">
          <div className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm space-y-4">
            <div>
              <h2 className="font-serif text-xl italic text-slate-950">Registry & contact</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Where your agents are hosted, and who manages this org.
              </p>
            </div>

            <Field
              label="Registry URL"
              value={form.registry_url}
              onChange={(v) => patch("registry_url", v)}
              onBlur={() => touch("registry_url")}
              placeholder="https://registry.nasiko.com"
              hint="The base URL of your Registry Server — where agent records are listed."
              error={visible("registry_url")}
            />

            <Field
              label="Contact Email"
              value={form.contact_email}
              onChange={(v) => patch("contact_email", v)}
              onBlur={() => touch("contact_email")}
              placeholder="admin@nasiko.com"
              type="email"
              hint="A verification link will be sent here to activate your index record."
              error={visible("contact_email")}
            />

            <div>
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                Cache TTL
              </span>
              <select
                value={form.ttl_seconds}
                onChange={(e) => patch("ttl_seconds", e.target.value)}
                className="w-full rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-slate-300"
              >
                {TTL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-400">
                How long resolvers should cache your index record before re-fetching.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={advanceTo3}
              className="rounded-2xl bg-slate-950 px-6 py-3 text-sm font-medium text-white"
            >
              Review →
            </button>
            <button
              onClick={() => setStep(1)}
              className="rounded-2xl border border-black/10 bg-white px-6 py-3 text-sm font-medium text-slate-700"
            >
              ← Back
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Review ───────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="mx-auto max-w-lg space-y-5">
          <div className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm">
            <h2 className="font-serif text-xl italic text-slate-950 mb-5">Review</h2>
            <dl className="divide-y divide-black/5">
              {[
                { label: "Org ID", value: form.org_id },
                { label: "Display Name", value: form.display_name },
                { label: "Domain", value: form.domain },
                { label: "Registry URL", value: form.registry_url },
                { label: "Contact Email", value: form.contact_email },
                {
                  label: "Cache TTL",
                  value:
                    TTL_OPTIONS.find((o) => o.value === form.ttl_seconds)?.label ??
                    form.ttl_seconds,
                },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between gap-4 py-3">
                  <dt className="shrink-0 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                    {label}
                  </dt>
                  <dd className="break-all text-right font-mono text-sm text-slate-950">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {apiError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {apiError}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={submit}
              disabled={saving}
              className="rounded-2xl bg-slate-950 px-6 py-3 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving ? "Registering…" : "Register"}
            </button>
            <button
              onClick={() => setStep(2)}
              className="rounded-2xl border border-black/10 bg-white px-6 py-3 text-sm font-medium text-slate-700"
            >
              ← Back
            </button>
          </div>
        </div>
      )}
    </PageShell>
  );
}
