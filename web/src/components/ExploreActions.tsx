"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearAuthToken, getAuthToken, isTokenExpired, parseJwtPayload, subscribeAuthChanges } from "@/lib/auth";
import { logout } from "@/lib/nanda-api";

const actionClass = "inline-flex min-h-10 items-center justify-center rounded-control border-2 border-line px-4 py-2 text-sm font-medium text-ink hover:border-line-strong transition";

export function ExploreActions() {
  const router = useRouter();
  // Recheck expiry on navigation and when stored credentials change.
  usePathname();
  const token = useSyncExternalStore(subscribeAuthChanges, getAuthToken, () => null);
  const payload = token && !isTokenExpired(token) ? parseJwtPayload(token) : null;
  const displayName = payload?.displayName || payload?.email || null;

  async function signOut() {
    try {
      await logout();
    } catch {
      // Sign out locally even if the session has expired or the API is unreachable.
    }
    clearAuthToken();
    router.push("/");
  }

  return (
    <nav aria-label="Explore tools" className="mb-8 flex flex-wrap items-center gap-3">
      {displayName ? (
        <>
          <Link href="/dashboard" className={`${actionClass} max-w-full gap-2`}>
            Dashboard
            <span className="max-w-40 truncate text-xs text-ink-weak">({displayName})</span>
          </Link>
          <button onClick={() => void signOut()} className={actionClass}>Sign out</button>
        </>
      ) : (
        <Link href="/login" className="inline-flex min-h-10 items-center justify-center rounded-control bg-brand-800 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 transition">
          Sign in
        </Link>
      )}
      <Link href="/query" className={actionClass}>Discover</Link>
      <Link href="/resolve" className={actionClass}>Resolve</Link>
      <Link href="/ongoing-projects" className={actionClass}>Ongoing Projects</Link>
    </nav>
  );
}
