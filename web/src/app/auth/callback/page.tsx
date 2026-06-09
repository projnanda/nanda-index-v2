"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setAuthToken, parseJwtPayload } from "@/lib/auth";

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const token = searchParams.get("token");
    if (!token || !parseJwtPayload(token)) {
      router.replace("/login?error=invalid_token");
      return;
    }

    setAuthToken(token);
    router.replace("/dashboard");
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
