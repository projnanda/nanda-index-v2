"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { ApiError, resetPassword } from "@/lib/nanda-api";

const inputClass =
  "w-full h-10 rounded-control border-2 border-line bg-surface-light px-3 text-sm text-ink placeholder:text-ink-weak focus:outline-none focus:border-brand-500 transition-colors";

const primaryBtnClass =
  "inline-flex items-center justify-center h-9 w-full rounded-control bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600 transition disabled:opacity-60";

function ResetPasswordInner() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell title="Set a new password" description="Choose a new password for your account.">
      <div className="mx-auto max-w-md space-y-5">
        <div className="bg-surface-light rounded-card border border-line p-8 shadow-card">
          {!token ? (
            <p className="text-sm text-ink-medium">
              This reset link is invalid or incomplete.{" "}
              <Link href="/forgot-password" className="underline hover:text-brand-600">
                Request a new one
              </Link>
              .
            </p>
          ) : done ? (
            <p className="text-sm text-ink-medium">
              Your password has been updated.{" "}
              <Link href="/login" className="underline hover:text-brand-600">
                Sign in
              </Link>{" "}
              with your new password.
            </p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-3">
              <input
                type="password"
                placeholder="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className={inputClass}
              />
              <input
                type="password"
                placeholder="Confirm new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                className={inputClass}
              />

              {error && (
                <p className="rounded-control border border-[#b42318]/30 bg-[#fef3f2] px-4 py-2.5 text-sm text-[#b42318]">
                  {error}
                </p>
              )}

              <button type="submit" disabled={loading} className={primaryBtnClass}>
                {loading ? "…" : "Update password"}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-ink-weak">
          <Link href="/login" className="underline hover:text-brand-600">
            Back to sign in
          </Link>
        </p>
      </div>
    </PageShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-sm text-ink-weak">Loading…</p>
        </div>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}
