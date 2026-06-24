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
  "bg-surface-light rounded-card border border-line shadow-card";

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
        <div className={`${cardClass} p-6 text-sm text-ink-weak`}>
          Loading…
        </div>
      </PageShell>
    );
  }

  if (error || !user) {
    return (
      <PageShell title="Dashboard" description="">
        <div className="rounded-card border border-[#b42318]/30 bg-[#fef3f2] p-4 text-sm text-[#b42318]">
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
        <div className={`${cardClass} flex items-center justify-between p-6`}>
          <div>
            <p className="font-semibold text-ink-strong">{user.display_name ?? user.email}</p>
            <p className="text-sm text-ink-medium">{user.email}</p>
          </div>
          <button
            onClick={signOut}
            className="inline-flex items-center justify-center h-9 rounded-control border-2 border-line bg-surface-light px-3 text-sm font-medium text-ink hover:border-line-strong transition"
          >
            Sign out
          </button>
        </div>

        {/* Organizations */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wide text-ink-weak">
              Your Organizations
            </h2>
            <Link
              href="/dashboard/orgs/new"
              className="inline-flex items-center justify-center h-9 rounded-control bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600 transition"
            >
              + Register new
            </Link>
          </div>

          {user.orgs.length === 0 ? (
            <div className={`${cardClass} p-6 text-sm text-ink-medium`}>
              You have no organizations yet.{" "}
              <Link href="/dashboard/orgs/new" className="text-brand-600 hover:underline">
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
                  className="bg-surface-light rounded-card border border-line/70 shadow-card p-4 hover:shadow-card-hover hover:border-line-strong transition cursor-pointer flex items-center justify-between gap-3"
                >
                  <div>
                    <p className="font-semibold text-ink-strong">{org.display_name}</p>
                    <p className="font-mono text-xs text-ink-weak">{org.org_id}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs capitalize text-ink-weak">{org.role}</span>
                    <StatusBadge status={org.status} />
                    {!org.domain_verified && (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-amber-600">
                        verify domain
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
