"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { StatusBadge } from "@/components/StatusBadge";
import { JsonPanel } from "@/components/JsonPanel";
import { ApiError, verifyEmail } from "@/lib/nanda-api";
import type { IndexRecord } from "@/lib/nanda-types";

const primaryBtnClass =
  "inline-flex items-center justify-center h-9 w-full rounded-control bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600 transition disabled:opacity-60";

function domainLabel(org: IndexRecord): string {
  if (!org.domain) return "None (personal entry)";
  return `${org.domain} — ${org.domain_verified ? "verified" : "not verified yet"}`;
}

/** Success view: a plain-language confirmation, then the record the index now holds. */
function EmailConfirmed({ org }: { org: IndexRecord }) {
  const active = org.status === "active";
  return (
    <div className="space-y-5">
      <div className="bg-surface-light rounded-card border border-line p-8 shadow-card space-y-4">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white">
            ✓
          </span>
          <h2 className="text-lg font-semibold text-ink-strong">Your email is confirmed</h2>
        </div>
        <p className="text-sm text-ink-medium">
          {active
            ? "Your entry is now live in the index."
            : org.status === "pending" && org.domain && !org.domain_verified
              ? "Next, verify your domain from the dashboard to make your entry live."
              : "Check your entry in the dashboard for its current publication status."}{" "}
          <Link href={`/dashboard/orgs/${encodeURIComponent(org.org_id)}`} className="underline hover:text-brand-600">
            Go to the dashboard
          </Link>
          .
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-ink-weak">Organization</dt>
          <dd className="min-w-0 text-ink-strong">
            {org.display_name} <span className="font-mono text-xs text-ink-weak">({org.org_id})</span>
          </dd>
          <dt className="text-ink-weak">Status</dt>
          <dd><StatusBadge status={org.status} /></dd>
          <dt className="text-ink-weak">Domain</dt>
          <dd className="min-w-0 break-all text-ink-strong">{domainLabel(org)}</dd>
          <dt className="text-ink-weak">Identifier</dt>
          <dd className="min-w-0 break-all font-mono text-xs text-ink-strong">{org.identifier}</dd>
        </dl>
      </div>
      <JsonPanel data={org} />
    </div>
  );
}

/**
 * Confirms a contact email. Verification happens on the button press, not on
 * page load: mail scanners open links before the recipient does, and used to
 * spend the single-use token so the real click reported failure.
 */
function VerifyEmailInner() {
  // Read the token once, then drop it from the address bar and history so it
  // isn't left behind in the URL after the page has it.
  const tokenFromUrl = useSearchParams().get("token") ?? "";
  const [token] = useState(tokenFromUrl);
  useEffect(() => {
    if (tokenFromUrl) window.history.replaceState(null, "", window.location.pathname);
  }, [tokenFromUrl]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; invalidToken: boolean } | null>(null);
  const [verifiedOrg, setVerifiedOrg] = useState<IndexRecord | null>(null);

  async function onConfirm() {
    setLoading(true);
    setError(null);
    try {
      setVerifiedOrg(await verifyEmail(token));
    } catch (err) {
      const invalidToken = err instanceof ApiError && err.status === 404;
      setError({
        invalidToken,
        message: invalidToken
          ? "This link has expired or was already used. If your dashboard shows the email as verified, you're done — otherwise send a new link from the dashboard."
          : "Something went wrong. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }

  if (verifiedOrg) {
    return (
      <PageShell title="Verify your email" description="Confirm the contact email for your NANDA Index registration.">
        <div className="mx-auto max-w-2xl">
          <EmailConfirmed org={verifiedOrg} />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="Verify your email" description="Confirm the contact email for your NANDA Index registration.">
      <div className="mx-auto max-w-md space-y-5">
        <div className="bg-surface-light rounded-card border border-line p-8 shadow-card space-y-4">
          {!token ? (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-ink-strong">Check email verification</h2>
              <p className="text-sm text-ink-medium">
                No verification token is present. If you already confirmed this address, no further action is needed. Open your{" "}
                <Link href="/dashboard" className="underline hover:text-brand-600">dashboard</Link>{" "}
                to check the current status or send a new verification link.
              </p>
            </div>
          ) : !error?.invalidToken ? (
            <>
              <p className="text-sm text-ink-medium">Press the button to confirm this email address.</p>
              <button onClick={onConfirm} disabled={loading} className={primaryBtnClass}>
                {loading ? "Verifying…" : "Verify email"}
              </button>
            </>
          ) : null}

          {error && (
            <div role="alert" className="space-y-3">
              <p className="rounded-control border border-[#b42318]/30 bg-[#fef3f2] px-4 py-2.5 text-sm text-[#b42318]">
                {error.message}
              </p>
              <Link href="/dashboard" className="text-sm underline hover:text-brand-600">Check verification or send a new link</Link>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<PageShell title="Verify your email" description="Loading verification…"><p role="status">Loading…</p></PageShell>}>
      <VerifyEmailInner />
    </Suspense>
  );
}
