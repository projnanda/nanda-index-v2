"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PageShell } from "@/components/PageShell";
import { ApiError, loginWithPassword, registerWithPassword, getAuthProviders } from "@/lib/nanda-api";
import { setAuthToken } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_NANDA_INDEX_API_URL ?? "";

type Mode = "login" | "register";

const inputClass =
  "w-full h-10 rounded-control border-2 border-line bg-surface-light px-3 text-sm text-ink placeholder:text-ink-weak focus:outline-none focus:border-brand-500 transition-colors";

const primaryBtnClass =
  "inline-flex items-center justify-center h-9 w-full rounded-control bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600 transition disabled:opacity-60";

const oauthBtnClass =
  "inline-flex items-center justify-center gap-3 h-9 w-full rounded-control border-2 border-line bg-surface-light px-3 text-sm font-medium text-ink hover:border-line-strong transition";

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason");
  const oauthError = searchParams.get("error");
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<{ google: boolean; github: boolean } | null>(null);

  useEffect(() => {
    getAuthProviders()
      .then(setProviders)
      .catch(() => setProviders({ google: false, github: false }));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const token =
        mode === "register"
          ? await registerWithPassword(email, password, displayName || undefined)
          : await loginWithPassword(email, password);

      setAuthToken(token);
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell
      title="Sign In"
      description="Sign in to manage your organization's index record."
    >
      <div className="mx-auto max-w-md space-y-5">
        {/* Session / OAuth notices */}
        {reason === "session_expired" && (
          <p className="rounded-control border border-[#8a5a06]/30 bg-[#fdeccc] px-4 py-2.5 text-sm text-[#8a5a06]">
            Your session expired. Please sign in again.
          </p>
        )}
        {oauthError === "oauth_not_configured" && (
          <p className="rounded-control border border-[#b42318]/30 bg-[#fef3f2] px-4 py-2.5 text-sm text-[#b42318]">
            OAuth login is not configured on this server. Use email and password instead.
          </p>
        )}
        {oauthError && oauthError !== "oauth_not_configured" && (
          <p className="rounded-control border border-[#b42318]/30 bg-[#fef3f2] px-4 py-2.5 text-sm text-[#b42318]">
            Sign-in failed. Please try again.
          </p>
        )}

        {/* Email / password form */}
        <div className="bg-surface-light rounded-card border border-line p-8 shadow-card">
          {/* Mode toggle */}
          <div className="mb-5 flex rounded-control border border-line bg-surface-strong p-1 text-sm">
            <button
              type="button"
              onClick={() => { setMode("login"); setError(null); }}
              className={`flex-1 rounded-control py-1.5 font-medium transition ${
                mode === "login"
                  ? "bg-surface-light text-ink-strong shadow-[var(--shadow-sm)]"
                  : "text-ink-medium hover:text-ink"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => { setMode("register"); setError(null); }}
              className={`flex-1 rounded-control py-1.5 font-medium transition ${
                mode === "register"
                  ? "bg-surface-light text-ink-strong shadow-[var(--shadow-sm)]"
                  : "text-ink-medium hover:text-ink"
              }`}
            >
              Create account
            </button>
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            {mode === "register" && (
              <input
                type="text"
                placeholder="Display name (optional)"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={inputClass}
              />
            )}
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={inputClass}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className={inputClass}
            />

            {error && (
              <p className="rounded-control border border-[#b42318]/30 bg-[#fef3f2] px-4 py-2.5 text-sm text-[#b42318]">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className={primaryBtnClass}
            >
              {loading ? "…" : mode === "register" ? "Create account" : "Sign in"}
            </button>
          </form>

          {mode === "login" && (
            <p className="mt-3 text-center text-xs text-ink-weak">
              <Link href="/forgot-password" className="underline hover:text-brand-600">
                Forgot your password?
              </Link>
            </p>
          )}
        </div>

        {/* OAuth buttons - only shown when provider is configured on the server */}
        {providers && (providers.google || providers.github) && (
          <>
            <div className="flex items-center gap-3 text-xs text-ink-weak">
              <div className="flex-1 border-t border-line" />
              or continue with
              <div className="flex-1 border-t border-line" />
            </div>

            {providers.google && (
              <a href={`${API_BASE}/auth/google`} className={oauthBtnClass}>
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </a>
            )}

            {providers.github && (
              <a href={`${API_BASE}/auth/github`} className={oauthBtnClass}>
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                </svg>
                Continue with GitHub
              </a>
            )}
          </>
        )}

        <p className="text-center text-xs text-ink-weak">
          <Link href="/" className="underline hover:text-brand-600">
            Browse public records
          </Link>{" "}
          without signing in.
        </p>
      </div>
    </PageShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-ink-weak">Loading…</p>
      </div>
    }>
      <LoginPageInner />
    </Suspense>
  );
}
