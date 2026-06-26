"use client";

import { useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { ApiError, forgotPassword } from "@/lib/nanda-api";

const inputClass =
  "w-full h-10 rounded-control border-2 border-line bg-surface-light px-3 text-sm text-ink placeholder:text-ink-weak focus:outline-none focus:border-brand-500 transition-colors";

const primaryBtnClass =
  "inline-flex items-center justify-center h-9 w-full rounded-control bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600 transition disabled:opacity-60";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await forgotPassword(email);
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell
      title="Forgot password"
      description="We'll email you a link to set a new password."
    >
      <div className="mx-auto max-w-md space-y-5">
        <div className="bg-surface-light rounded-card border border-line p-8 shadow-card">
          {submitted ? (
            <p className="text-sm text-ink-medium">
              If an account exists for <span className="font-medium text-ink">{email}</span>,
              we&apos;ve sent a password reset link. Check your inbox and spam folder.
            </p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-3">
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={inputClass}
              />

              {error && (
                <p className="rounded-control border border-[#b42318]/30 bg-[#fef3f2] px-4 py-2.5 text-sm text-[#b42318]">
                  {error}
                </p>
              )}

              <button type="submit" disabled={loading} className={primaryBtnClass}>
                {loading ? "…" : "Send reset link"}
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
