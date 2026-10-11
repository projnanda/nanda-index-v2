"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { ApiError, createOrg } from "@/lib/nanda-api";
import { cn } from "@/lib/utils";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import type { CatalogExtensions, HostingPath, IndexRecord } from "@/lib/nanda-types";
import { NANDA_EXTENSION, PERSONAL_CARD_HOST, isAnchoredTo, previewIdentifier } from "@/lib/air";

// ── Types ────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

interface FormState {
  hosting_path: HostingPath;
  // Step 1 — identity
  org_id: string;
  display_name: string;
  domain: string;           // registry / dns-svcb / smb
  identity_email: string;   // personal only — also the verified contact address
  identifier: string;       // optional override in advanced (domain paths only)
  // Step 2 — catalog details (varies by path)
  registry_url: string;         // catalog URL (registry) or agent card URL (others)
  agent_id: string;             // smb / dns-svcb optional — identifier short-name, e.g. "orders"
  runtime_provider: string;     // smb / personal optional
  runtime_url: string;          // smb / personal optional
  auth_metadata: string;        // smb / personal optional
  auth_execution: string;       // smb / personal optional
  description: string;
  tags: string;
  version: string;              // optional SemVer of the artifact
  // Step 3 — contact
  contact_email: string;
  ttl_seconds: string;
}

const EMPTY: FormState = {
  hosting_path: "registry",
  org_id: "",
  display_name: "",
  domain: "",
  identity_email: "",
  identifier: "",
  registry_url: "",
  agent_id: "",
  runtime_provider: "",
  runtime_url: "",
  auth_metadata: "",
  auth_execution: "",
  description: "",
  tags: "",
  version: "",
  contact_email: "",
  ttl_seconds: "86400",
};

const TTL_OPTIONS = [
  { label: "1 hour", value: "3600" },
  { label: "6 hours", value: "21600" },
  { label: "24 hours (recommended)", value: "86400" },
  { label: "7 days", value: "604800" },
];

const RUNTIME_PROVIDERS = ["AWS", "Azure", "GCP", "Railway", "GoDaddy", "Vercel", "Other"];

const PATH_LABEL: Record<HostingPath, string> = {
  registry: "Enterprise AI Catalog",
  "dns-svcb": "DNS SVCB",
  smb: "SMB Agent Card",
  personal: "Personal Agent",
};

const SHORT_NAME_RE = /^[A-Za-z0-9._~-]+$/;

const ORG_ID_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$|^[a-z0-9]$/;
const DOMAIN_RE = /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  if (form.hosting_path === "personal") {
    if (!form.identity_email) {
      e.identity_email = "Required.";
    } else if (!EMAIL_RE.test(form.identity_email)) {
      e.identity_email = "Enter a valid email address.";
    }
  } else {
    if (!form.domain) {
      e.domain = "Required.";
    } else if (!DOMAIN_RE.test(form.domain)) {
      e.domain = "Enter a valid domain (e.g., moonbakery.com).";
    }
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
  if (form.agent_id && !SHORT_NAME_RE.test(form.agent_id)) {
    e.agent_id = "Letters, numbers, dots, hyphens and underscores only.";
  }
  if (form.identifier && form.hosting_path !== "personal" && !isAnchoredTo(form.identifier, form.domain)) {
    e.identifier = `Must be urn:air:${form.domain || "<domain>"}:<namespace>:<name>.`;
  }
  return e;
}

function validateStep3(form: FormState): Record<string, string> {
  const e: Record<string, string> = {};
  // Personal registrations verify the identity email itself — it is the contact.
  if (form.hosting_path === "personal") return e;
  if (!form.contact_email) {
    e.contact_email = "Required.";
  } else if (!EMAIL_RE.test(form.contact_email)) {
    e.contact_email = "Enter a valid email address.";
  }
  return e;
}

// ── Shared Field ──────────────────────────────────────────────────────────────

function Field({
  label, value, onChange, onBlur, placeholder, type = "text",
  hint, error, textarea, optional,
}: {
  label: string; value: string; onChange: (v: string) => void;
  onBlur?: () => void; placeholder?: string; type?: string;
  hint?: string; error?: string; textarea?: boolean; optional?: boolean;
}) {
  const cls = cn(
    "w-full rounded-2xl border px-4 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-slate-300 bg-white transition",
    error ? "border-rose-300 bg-rose-50/40" : "border-black/10",
  );
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
        {label}
        {optional && <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">(optional)</span>}
      </span>
      {textarea ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
          placeholder={placeholder} rows={3} className={cn(cls, "resize-none")} />
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur} placeholder={placeholder} className={cls} />
      )}
      {error ? <p className="mt-1 text-[11px] text-rose-500">{error}</p>
        : hint ? <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
          : null}
    </label>
  );
}

// ── Path card ─────────────────────────────────────────────────────────────────

function PathCard({ value, selected, onSelect, title, subtitle, description }: {
  value: HostingPath; selected: HostingPath; onSelect: (v: HostingPath) => void;
  title: string; subtitle: string; description: string;
}) {
  const active = value === selected;
  return (
    <button type="button" onClick={() => onSelect(value)}
      className={cn(
        "flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition w-full",
        active ? "border-slate-950 bg-slate-950 text-white" : "border-black/10 bg-white hover:border-slate-400",
      )}
    >
      <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
        active ? "border-white bg-white" : "border-slate-400")}>
        {active && <span className="h-2 w-2 rounded-full bg-slate-950" />}
      </span>
      <div>
        <p className={cn("text-sm font-semibold leading-tight", active ? "text-white" : "text-slate-950")}>
          {title}
          <span className={cn("ml-2 text-xs font-normal", active ? "text-slate-300" : "text-slate-400")}>
            {subtitle}
          </span>
        </p>
        <p className={cn("mt-0.5 text-xs", active ? "text-slate-300" : "text-slate-500")}>
          {description}
        </p>
      </div>
    </button>
  );
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const steps = [
    { label: "Identity", step: 1 as Step },
    { label: "Catalog", step: 2 as Step },
    { label: "Contact", step: 3 as Step },
  ];
  return (
    <div className="mb-8 flex items-start justify-center">
      {steps.map(({ label, step }, i) => {
        const done = step < current;
        const active = step === current;
        return (
          <div key={label} className="flex items-center">
            {i > 0 && <div className={cn("mb-5 h-px w-14", done ? "bg-slate-950" : "bg-black/10")} />}
            <div className="flex flex-col items-center gap-1.5">
              <div className={cn("flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition",
                active ? "bg-slate-950 text-white shadow-md"
                  : done ? "bg-emerald-500 text-white"
                    : "border-2 border-black/10 bg-white text-slate-400")}>
                {done ? "✓" : step}
              </div>
              <span className={cn("hidden text-[10px] font-medium uppercase tracking-[0.14em] sm:block",
                active ? "text-slate-950" : done ? "text-emerald-600" : "text-slate-400")}>
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

function SuccessScreen({ record, path }: { record: IndexRecord; path: HostingPath }) {
  const isPersonal = path === "personal";
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-7 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white text-xl font-bold">✓</div>
        <h2 className="font-serif text-2xl italic text-emerald-900">Registered</h2>
        <p className="mt-1 font-mono text-sm text-emerald-700">{record.org_id}</p>
      </div>
      <div className="rounded-2xl border border-black/5 bg-slate-50 px-4 py-3">
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">Identifier</p>
        <p className="mt-1 break-all font-mono text-sm text-slate-950">{record.identifier}</p>
      </div>
      {isPersonal ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-sm font-semibold text-amber-800">Confirm your email to go live</p>
          <p className="mt-0.5 text-xs text-amber-700">
            Your record is <span className="font-semibold">pending</span> and hidden from the public index until you confirm your contact address. We&apos;ve emailed a verification link — no domain ownership needed for personal agents.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-sm font-semibold text-amber-800">Verify your domain to go live</p>
          <p className="mt-0.5 text-xs text-amber-700">
            Your record is <span className="font-semibold">pending</span> and hidden from the public index until you prove ownership of <span className="mx-0.5 font-mono">{record.domain}</span> by adding a DNS TXT record. Open your org to get the record. (We&apos;ve also emailed a link to confirm your contact address.)
          </p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {!isPersonal && (
          <Link href={`/dashboard/orgs/${record.org_id}`}
            className="flex flex-col rounded-2xl border border-amber-300 bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-sm">
            <span className="text-sm font-semibold text-slate-950">Verify domain →</span>
            <span className="mt-0.5 text-xs text-slate-500">Get your DNS TXT record and activate this org.</span>
          </Link>
        )}
        {path === "registry" && (
          <Link href="/rap" className="flex flex-col rounded-2xl border border-black/10 bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-sm">
            <span className="text-sm font-semibold text-slate-950">Add agents →</span>
            <span className="mt-0.5 text-xs text-slate-500">Open Registry Manager to register your first agent.</span>
          </Link>
        )}
        {(path === "smb" || path === "personal") && (
          <a href="https://host39.org" target="_blank" rel="noopener noreferrer"
            className="flex flex-col rounded-2xl border border-black/10 bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-sm">
            <span className="text-sm font-semibold text-slate-950">Manage on host39.org →</span>
            <span className="mt-0.5 text-xs text-slate-500">Update your agent card on host39.org.</span>
          </a>
        )}
        {isPersonal && (
          <Link href={`/dashboard/orgs/${record.org_id}`}
            className="flex flex-col rounded-2xl border border-black/10 bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-sm">
            <span className="text-sm font-semibold text-slate-950">View your org →</span>
            <span className="mt-0.5 text-xs text-slate-500">Check status and edit details.</span>
          </Link>
        )}
        {path === "dns-svcb" && (
          <div className="flex flex-col rounded-2xl border border-black/10 bg-white p-4">
            <span className="text-sm font-semibold text-slate-950">DNS SVCB pointer</span>
            <span className="mt-0.5 text-xs text-slate-500">Resolvers can confirm the endpoint via your SVCB records.</span>
          </div>
        )}
      </div>
      <p className="text-center">
        <Link href="/dashboard" className="text-xs text-slate-400 hover:text-slate-700">Back to dashboard</Link>
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [created, setCreated] = useState<IndexRecord | null>(null);

  const patch = (key: keyof FormState, val: string) => setForm((f) => ({ ...f, [key]: val }));
  const touch = (...keys: string[]) =>
    setTouched((t) => Object.fromEntries([...Object.entries(t), ...keys.map((k) => [k, true])]));

  const s1Errors = validateStep1(form);
  const s2Errors = validateStep2(form);
  const s3Errors = validateStep3(form);
  const allErrors = { ...s1Errors, ...s2Errors, ...s3Errors };
  const visible = (key: string) => (touched[key] ? allErrors[key] : undefined);

  const isPersonal = form.hosting_path === "personal";
  const isAgentCard = form.hosting_path === "smb" || isPersonal;

  const isAgentPointer = form.hosting_path === "smb" || form.hosting_path === "dns-svcb";
  // What the server will assign unless the advanced override is used.
  const derivedIdentifier = previewIdentifier(form.hosting_path, {
    domain: form.domain, email: form.identity_email, shortName: form.agent_id || form.org_id,
  });

  function patchPath(v: HostingPath) {
    // An identifier override is anchored to the old path's shape — drop it.
    setForm((f) => ({ ...f, hosting_path: v, identifier: "" }));
  }

  function advanceTo2() {
    const fields = isPersonal
      ? ["org_id", "display_name", "identity_email"]
      : ["org_id", "display_name", "domain"];
    touch(...fields);
    if (fields.every((f) => !s1Errors[f])) setStep(2);
  }

  function advanceTo3() {
    const fields = ["registry_url", "agent_id", "identifier"];
    touch(...fields);
    if (fields.every((f) => !s2Errors[f])) setStep(3);
  }

  async function submit() {
    touch("contact_email");
    if (s3Errors.contact_email) return;

    setSaving(true);
    setApiError(null);
    try {
      const tagList = form.tags.split(",").map((t) => t.trim()).filter(Boolean);

      // Client-controlled routing hints only — the server owns resolutionRole,
      // preferredDiscovery, subjectAccount and the identifier/publisher anchor.
      const nandaHints: Record<string, string> = isAgentCard
        ? {
          agentCardHost: new URL(form.registry_url).hostname,
          ...(form.runtime_provider ? { "runtime.provider": form.runtime_provider } : {}),
          ...(form.runtime_url ? { "runtime.url": form.runtime_url } : {}),
          ...(form.auth_metadata ? { "auth.metadata": form.auth_metadata } : {}),
          ...(form.auth_execution ? { "auth.execution": form.auth_execution } : {}),
        }
        : {};
      const extensions: CatalogExtensions = { [NANDA_EXTENSION]: nandaHints };

      // Advanced override or custom short-name; otherwise the server derives it.
      const identifier = form.identifier
        || (isAgentPointer && form.agent_id ? derivedIdentifier : undefined);

      const record = await createOrg({
        org_id: form.org_id,
        display_name: form.display_name,
        hosting_path: form.hosting_path,
        domain: isPersonal ? undefined : (form.domain || undefined),
        contact_email: isPersonal ? form.identity_email : form.contact_email,
        registry_url: form.registry_url,
        ttl_seconds: parseInt(form.ttl_seconds, 10) || 86400,
        identifier: isPersonal ? undefined : identifier,
        description: form.description || undefined,
        tags: tagList.length ? tagList : undefined,
        version: form.version || undefined,
        extensions,
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
      <PageShell title="Registered" description="">
        <SuccessScreen record={created} path={form.hosting_path} />
      </PageShell>
    );
  }

  return (
    <PageShell title="Register" description="Add your organization to the NANDA Index.">
      <StepIndicator current={step} />

      {/* ── Step 1: Identity ──────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="mx-auto max-w-lg space-y-5">
          <div className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm space-y-4">
            <div>
              <h2 className="font-serif text-xl italic text-slate-950">Identity</h2>
              <p className="mt-0.5 text-xs text-slate-500">Choose who you are and how you publish agents.</p>
            </div>

            {/* Path choice first so domain/email fields adapt immediately */}
            <div className="space-y-2">
              <span className="block text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                What best describes you?
              </span>
              <PathCard value="registry" selected={form.hosting_path} onSelect={patchPath}
                title="Enterprise AI Catalog" subtitle="Teams / Orgs"
                description="Run your own nanda-ai-catalog. Full control over your AI catalog." />
              <PathCard value="dns-svcb" selected={form.hosting_path} onSelect={patchPath}
                title="DNS SVCB" subtitle="Enterprise / DNS"
                description="Your agent is discoverable via DNS service binding (SVCB, RFC 9460). NandaIndex acts as a federated pointer." />
              <PathCard value="smb" selected={form.hosting_path} onSelect={patchPath}
                title="SMB Agent Card" subtitle="Small Business"
                description="You own a domain but don't run infrastructure. Host your agent card on host39.org." />
              <PathCard value="personal" selected={form.hosting_path} onSelect={patchPath}
                title="Personal Agent" subtitle="Individual"
                description="No domain needed. Your verified email is your identity, anchored at host39.org." />
            </div>

            <Field label="Org ID" value={form.org_id} onChange={(v) => patch("org_id", v)}
              onBlur={() => touch("org_id")} placeholder="moon-bakery"
              hint="Lowercase letters, numbers, hyphens. Permanent — cannot be changed later."
              error={visible("org_id")} />

            <Field label="Display Name" value={form.display_name} onChange={(v) => patch("display_name", v)}
              onBlur={() => touch("display_name")} placeholder={isPersonal ? "John" : "Moon Bakery"}
              error={visible("display_name")} />

            {/* Domain (all except personal) */}
            {!isPersonal && (
              <Field label="Domain" value={form.domain} onChange={(v) => patch("domain", v)}
                onBlur={() => touch("domain")} placeholder="moonbakery.com"
                hint="Agents will be addressable under this domain."
                error={visible("domain")} />
            )}

            {/* Email identity (personal only) */}
            {isPersonal && (
              <Field label="Email Identity" value={form.identity_email} onChange={(v) => patch("identity_email", v)}
                onBlur={() => touch("identity_email")} type="email" placeholder="john@hotmail.com"
                hint={`We email a verification link here. Your identifier: urn:air:${PERSONAL_CARD_HOST}:personal:john@hotmail.com`}
                error={visible("identity_email")} />
            )}

            {/* Locator preview */}
            {((isPersonal && form.identity_email && !s1Errors.identity_email) ||
              (!isPersonal && form.domain && !s1Errors.domain)) && (
                <div className="rounded-2xl border border-black/5 bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">Identifier preview</p>
                  <p className="mt-1 font-mono text-sm text-slate-950 break-all">
                    {derivedIdentifier}
                  </p>
                </div>
              )}
          </div>

          <div className="flex gap-3">
            <button onClick={advanceTo2} className="rounded-2xl bg-slate-950 px-6 py-3 text-sm font-medium text-white">
              Continue →
            </button>
            <button onClick={() => router.back()}
              className="rounded-2xl border border-black/10 bg-white px-6 py-3 text-sm font-medium text-slate-700">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Catalog details ──────────────────────────────────────── */}
      {step === 2 && (
        <div className="mx-auto max-w-lg space-y-5">
          <div className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm space-y-4">
            <div>
              <h2 className="font-serif text-xl italic text-slate-950">
                {form.hosting_path === "registry" && "Catalog details"}
                {form.hosting_path === "dns-svcb" && "Agent card details"}
                {form.hosting_path === "smb" && "Agent card details"}
                {form.hosting_path === "personal" && "Agent card details"}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {form.hosting_path === "registry" && "Where your AI Catalog is published."}
                {form.hosting_path === "dns-svcb" && "The agent card your SVCB records point to."}
                {form.hosting_path === "smb" && "Your agent card URL and optional runtime info."}
                {form.hosting_path === "personal" && "Your agent card URL and optional runtime info."}
              </p>
            </div>

            {/* Registry path */}
            {form.hosting_path === "registry" && (
              <Field label="AI Catalog Hosted URL" value={form.registry_url}
                onChange={(v) => patch("registry_url", v)} onBlur={() => touch("registry_url")}
                placeholder="https://example.com/.well-known/ai-catalog.json"
                hint="Your AI Catalog endpoint (or the base URL of your nanda-registry server)."
                error={visible("registry_url")} />
            )}

            {/* DNS SVCB path */}
            {form.hosting_path === "dns-svcb" && (
              <>
                <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3">
                  <p className="text-xs font-semibold text-sky-800">Before you continue</p>
                  <p className="mt-0.5 text-xs text-sky-700">
                    Publish SVCB/HTTPS records (RFC 9460) under {form.domain || "your domain"} for this agent&apos;s endpoint. NandaIndex stores a federated pointer to the A2A Agent Card; your DNS stays authoritative.
                  </p>
                </div>
                <Field label="Agent Card URL" value={form.registry_url}
                  onChange={(v) => patch("registry_url", v)} onBlur={() => touch("registry_url")}
                  placeholder={`https://api.${form.domain || "skyblue.com"}/agents/refunds.json`}
                  hint="The URL of the A2A Agent Card your DNS records point to."
                  error={visible("registry_url")} />
              </>
            )}

            {isAgentPointer && (
              <Field label="Agent ID" value={form.agent_id}
                onChange={(v) => patch("agent_id", v)} onBlur={() => touch("agent_id")}
                placeholder="orders"
                hint={`Identifier short-name: urn:air:${form.domain || "<domain>"}:agent:<id>. Defaults to your Org ID.`}
                error={visible("agent_id")} optional />
            )}

            {/* SMB + Personal paths */}
            {isAgentCard && (
              <>
                <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3">
                  <p className="text-xs font-semibold text-sky-800">Before you continue</p>
                  <p className="mt-0.5 text-xs text-sky-700">
                    Create your agent card on{" "}
                    <a href="https://host39.org" target="_blank" rel="noopener noreferrer" className="underline">host39.org</a>
                    {" "}first, then paste the card URL below.
                  </p>
                </div>

                <Field label="Agent Card URL" value={form.registry_url}
                  onChange={(v) => patch("registry_url", v)} onBlur={() => touch("registry_url")}
                  placeholder={
                    form.hosting_path === "smb"
                      ? "https://agentcards.host39.org/moonbakery.com/orders.json"
                      : "https://agentcards.host39.org/personal/john@hotmail.com/card.json"
                  }
                  hint="The URL of your A2A Agent Card."
                  error={visible("registry_url")} />

                {/* Runtime info */}
                <div className="space-y-3 border-t border-black/5 pt-3">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Runtime & auth <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span></p>

                  <div>
                    <span className="mb-1 block text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                      Runtime provider <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span>
                    </span>
                    <select value={form.runtime_provider} onChange={(e) => patch("runtime_provider", e.target.value)}
                      className="w-full rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-slate-300">
                      <option value="">— not specified —</option>
                      {RUNTIME_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>

                  <Field label="Runtime URL" value={form.runtime_url}
                    onChange={(v) => patch("runtime_url", v)}
                    placeholder="https://my-agent.aws.example.com"
                    hint="The endpoint where your agent runtime is hosted." optional />

                  <Field label="Auth metadata" value={form.auth_metadata}
                    onChange={(v) => patch("auth_metadata", v)}
                    placeholder="public"
                    hint='Describes what metadata is public. E.g. "public", "public_minimal".' optional />

                  <Field label="Auth execution" value={form.auth_execution}
                    onChange={(v) => patch("auth_execution", v)}
                    placeholder="payment_or_session_token_required"
                    hint='What callers need to invoke this agent. E.g. "user_consent_required".' optional />
                </div>
              </>
            )}

            <Field label="Description" value={form.description} onChange={(v) => patch("description", v)}
              placeholder="Ordering agent for Moon Bakery. Supports menu lookup, order placement, and pickup scheduling."
              textarea optional />

            <Field label="Tags" value={form.tags} onChange={(v) => patch("tags", v)}
              placeholder="smb, bakery, orders, a2a-agent-card"
              hint="Comma-separated labels." optional />

            <Field label="Version" value={form.version} onChange={(v) => patch("version", v)}
              placeholder="v1.0.0"
              hint="SemVer of this artifact (shown on the card)." optional />

            {/* Advanced: identifier override */}
            <div className="border-t border-black/5 pt-3">
              <button type="button" onClick={() => setShowAdvanced((v) => !v)}
                className="text-xs text-slate-400 hover:text-slate-700 transition">
                {showAdvanced ? "Hide advanced ▲" : "Show advanced ▼"}
              </button>
              {showAdvanced && (
                <div className="mt-3">
                  {isPersonal ? (
                    <p className="text-xs text-slate-500">
                      Personal identifiers are derived from your verified email and cannot be overridden.
                    </p>
                  ) : (
                    <Field label="Identifier (urn:air)" value={form.identifier}
                      onChange={(v) => patch("identifier", v)} onBlur={() => touch("identifier")}
                      placeholder={derivedIdentifier}
                      hint={`Override only if you need a custom path. Must stay under urn:air:${form.domain || "<domain>"}:`}
                      error={visible("identifier")} optional />
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={advanceTo3} className="rounded-2xl bg-slate-950 px-6 py-3 text-sm font-medium text-white">
              Continue →
            </button>
            <button onClick={() => setStep(1)}
              className="rounded-2xl border border-black/10 bg-white px-6 py-3 text-sm font-medium text-slate-700">
              ← Back
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Contact & review ──────────────────────────────────────── */}
      {step === 3 && (
        <div className="mx-auto max-w-lg space-y-5">
          <div className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm space-y-4">
            <div>
              <h2 className="font-serif text-xl italic text-slate-950">Contact & review</h2>
              <p className="mt-0.5 text-xs text-slate-500">Confirm your details before submitting.</p>
            </div>

            {isPersonal ? (
              <div className="rounded-2xl border border-black/5 bg-slate-50 px-4 py-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">Verification email</p>
                <p className="mt-1 font-mono text-sm text-slate-950 break-all">{form.identity_email}</p>
                <p className="mt-1 text-[11px] text-slate-400">Confirming this address binds it to your identifier and activates the record.</p>
              </div>
            ) : (
              <Field label="Contact Email" value={form.contact_email}
                onChange={(v) => patch("contact_email", v)} onBlur={() => touch("contact_email")}
                placeholder="admin@moonbakery.com" type="email"
                hint="A verification link will be sent here to activate your index record."
                error={visible("contact_email")} />
            )}

            <div>
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Cache TTL</span>
              <select value={form.ttl_seconds} onChange={(e) => patch("ttl_seconds", e.target.value)}
                className="w-full rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-slate-300">
                {TTL_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-slate-400">How long resolvers should cache your index record.</p>
            </div>

            {/* Summary */}
            <div className="border-t border-black/5 pt-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Summary</p>
              <dl className="divide-y divide-black/5">
                {[
                  { label: "Org ID", value: form.org_id },
                  { label: "Display Name", value: form.display_name },
                  { label: "Path", value: PATH_LABEL[form.hosting_path] },
                  { label: "Identifier", value: form.identifier || derivedIdentifier },
                  ...(!isPersonal && form.domain ? [{ label: "Domain", value: form.domain }] : []),
                  ...(isPersonal && form.identity_email ? [{ label: "Email Identity", value: form.identity_email }] : []),
                  ...(form.registry_url
                    ? [{ label: form.hosting_path === "registry" ? "Catalog URL" : "Agent Card URL", value: form.registry_url }]
                    : []),
                  ...(form.description ? [{ label: "Description", value: form.description }] : []),
                  ...(form.tags ? [{ label: "Tags", value: form.tags }] : []),
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between gap-4 py-2.5">
                    <dt className="shrink-0 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">{label}</dt>
                    <dd className="break-all text-right font-mono text-sm text-slate-950">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          {apiError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{apiError}</div>
          )}

          <div className="flex gap-3">
            <button onClick={submit} disabled={saving}
              className="rounded-2xl bg-slate-950 px-6 py-3 text-sm font-medium text-white disabled:opacity-60">
              {saving ? "Registering…" : "Register"}
            </button>
            <button onClick={() => setStep(2)}
              className="rounded-2xl border border-black/10 bg-white px-6 py-3 text-sm font-medium text-slate-700">
              ← Back
            </button>
          </div>
        </div>
      )}
    </PageShell>
  );
}
