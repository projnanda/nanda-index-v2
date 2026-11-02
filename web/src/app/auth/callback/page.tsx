"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setAuthToken, parseJwtPayload } from "@/lib/auth";
import { exchangeLoginCode } from "@/lib/nanda-api";

/**
 * Finishes an OAuth sign-in. The API redirects here with a one-time code
 * (never the session token) and the page swaps it for a session with a
 * POST that carries the API's login nonce cookie, so a code only works in
 * the browser that signed in. A link with someone else's code or token
 * therefore cannot sign this browser in to their account.
 */
function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const code = searchParams.get("code");
    // Keep the code out of browser history, even though it is single-use.
    window.history.replaceState(null, "", window.location.pathname);
    if (!code) {
      router.replace("/login?error=invalid_token");
      return;
    }

    exchangeLoginCode(code)
      .then((token) => {
        if (!parseJwtPayload(token)) throw new Error("malformed session token");
        setAuthToken(token);
        router.replace("/dashboard");
      })
      .catch(() => router.replace("/login?error=invalid_token"));
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-slate-400">Signing you in…</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    }>
      <AuthCallbackInner />
    </Suspense>
  );
}
