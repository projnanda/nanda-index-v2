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
        <div className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm text-sm text-slate-400">
          Loading…
        </div>
      </PageShell>
    );
  }

  if (error || !user) {
    return (
      <PageShell title="Dashboard" description="">
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
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
        <div className="flex items-center justify-between rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
          <div>
            <p className="font-semibold text-slate-950">{user.display_name ?? user.email}</p>
            <p className="text-sm text-slate-500">{user.email}</p>
          </div>
          <button
            onClick={signOut}
            className="rounded-2xl border border-black/10 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>

        {/* Organizations */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
              Your Organizations
            </h2>
            <Link
              href="/dashboard/orgs/new"
              className="rounded-full border border-black/10 bg-white px-4 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              + Register new
            </Link>
          </div>

          {user.orgs.length === 0 ? (
            <div className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm text-sm text-slate-400">
              You have no organizations yet.{" "}
              <Link href="/dashboard/orgs/new" className="text-indigo-600 hover:underline">
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
                  className="flex items-center justify-between rounded-3xl border border-black/10 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div>
                    <p className="font-medium text-slate-950">{org.display_name}</p>
                    <p className="font-mono text-xs text-slate-500">{org.org_id}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400 capitalize">{org.role}</span>
                    <StatusBadge status={org.status} />
                    {!org.email_verified && (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-amber-600">
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
