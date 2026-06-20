"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { StatusBadge } from "@/components/StatusBadge";
import { ApiError, getMe } from "@/lib/nanda-api";
import { clearAuthToken } from "@/lib/auth";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import type { User } from "@/lib/nanda-types";

const cardClass =
  "rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-[var(--shadow-card)]";

export default function DashboardPage() {
  useRequireAuth();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getMe()
      .then((data) => { if (!cancelled) setUser(data); })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          clearAuthToken();
          router.replace("/login");
        } else {
          setError("Could not load profile.");
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [router]);

  function signOut() {
    clearAuthToken();
    setLoading(true);
    router.replace("/");
  }

  if (loading) {
    return (
      <PageShell title="Dashboard" description="Loading your profile…">
        <div className={`${cardClass} p-6 text-sm text-[color:var(--color-fg-weak)]`}>
          Loading…
        </div>
      </PageShell>
    );
  }

  if (error || !user) {
    return (
      <PageShell title="Dashboard" description="">
        <div className="rounded-[var(--radius-card)] border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger-soft)] p-4 text-sm text-[color:var(--color-danger)]">
          {error ?? "Something went wrong."}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Dashboard"
      description={`Signed in as ${user.email}`}
    >
      <div className="space-y-6">
        {/* Profile card */}
        <div className={`${cardClass} flex items-center justify-between p-5`}>
          <div>
            <p className="font-semibold text-[color:var(--color-fg-strong)]">{user.display_name ?? user.email}</p>
            <p className="text-sm text-[color:var(--color-fg-muted)]">{user.email}</p>
          </div>
          <button
            onClick={signOut}
            className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 text-sm font-medium text-[color:var(--color-fg-default)] transition-colors hover:bg-[color:var(--color-surface-2)]"
          >
            Sign out
          </button>
        </div>

        {/* Organizations */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-fg-weak)]">
              Your Organizations
            </h2>
            <Link
              href="/dashboard/orgs/new"
              className="inline-flex h-9 items-center rounded-[var(--radius-control)] bg-[color:var(--color-primary)] px-4 text-sm font-medium text-white transition-colors hover:bg-[color:var(--color-primary-hover)]"
            >
              + Register new
            </Link>
          </div>

          {user.orgs.length === 0 ? (
            <div className={`${cardClass} p-6 text-sm text-[color:var(--color-fg-muted)]`}>
              You have no organizations yet.{" "}
              <Link href="/dashboard/orgs/new" className="text-[color:var(--color-primary)] hover:underline">
                Register one
              </Link>
              .
            </div>
          ) : (
            <div className="space-y-3">
              {user.orgs.map((org) => (
                <Link
                  key={org.org_id}
                  href={`/dashboard/orgs/${org.org_id}`}
                  className={`${cardClass} flex items-center justify-between p-5 transition hover:-translate-y-0.5 hover:border-[color:var(--color-border-strong)] hover:shadow-[var(--shadow-card-hover)]`}
                >
                  <div>
                    <p className="font-medium text-[color:var(--color-fg-strong)]">{org.display_name}</p>
                    <p className="font-mono text-xs text-[color:var(--color-fg-weak)]">{org.org_id}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs capitalize text-[color:var(--color-fg-weak)]">{org.role}</span>
                    <StatusBadge status={org.status} />
                    {!org.email_verified && (
                      <span className="rounded-full bg-[color:var(--color-warning-soft)] px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-[color:var(--color-warning)]">
                        verify email
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
