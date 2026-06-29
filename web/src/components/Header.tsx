"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { navigation } from "@/lib/site-data";
import { getAuthToken, parseJwtPayload, clearAuthToken, isTokenExpired } from "@/lib/auth";

export function Header() {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    const token = getAuthToken();
    if (!token || isTokenExpired(token)) {
      setDisplayName(null);
      return;
    }
    const payload = parseJwtPayload(token);
    setDisplayName(payload?.displayName ?? payload?.email ?? null);
  }, [pathname]);

  function closeMobileMenu() {
    if (detailsRef.current) detailsRef.current.open = false;
  }

  function signOut() {
    clearAuthToken();
    setDisplayName(null);
    router.push("/");
  }

  // Public nav items (always shown)
  const publicNav = navigation.filter(
    (item) => item.href !== "/login" && item.href !== "/dashboard"
  );

  const userInitial = displayName?.trim().charAt(0).toUpperCase() ?? "";

  return (
    <header className="bg-surface-light border-b border-line sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-4">
        {/* LEFT: brand */}
        <Link
          href="/"
          className="flex items-center gap-3 min-w-0 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-card bg-brand-800 text-white text-xs font-semibold tracking-wide">
            NI
          </span>
          <span aria-hidden="true" className="hidden sm:block h-6 border-l border-line" />
          <span className="hidden sm:flex flex-col leading-tight min-w-0">
            <span className="font-semibold text-ink-strong truncate">Nanda Index</span>
            <span className="text-xs text-ink-weak truncate">Agent identity &amp; discovery</span>
          </span>
        </Link>

        {/* RIGHT: nav + counter + auth */}
        <div className="flex items-center gap-6">
          <nav className="hidden items-center gap-6 lg:flex">
            {publicNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm font-medium text-ink-medium hover:text-brand-600 transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden lg:block">
            {displayName ? (
              <div className="flex items-center gap-3">
                <Link
                  href="/dashboard"
                  className="flex items-center gap-2 text-sm text-ink hover:text-brand-600 transition-colors"
                >
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-200 text-xs font-semibold text-brand-800">
                    {userInitial}
                  </span>
                  <span className="truncate max-w-[12rem]">{displayName}</span>
                </Link>
                <button
                  onClick={signOut}
                  className="text-xs text-ink-weak hover:text-ink transition-colors"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                className="inline-flex h-9 items-center rounded-control bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600 transition"
              >
                Sign in
              </Link>
            )}
          </div>

          <details ref={detailsRef} className="relative lg:hidden">
            <summary className="cursor-pointer list-none rounded-control border-2 border-line bg-surface-light px-3 py-1.5 text-sm font-medium text-ink hover:border-line-strong transition">
              Menu
            </summary>

            <div className="absolute right-0 mt-2 w-56 rounded-card border border-line bg-surface-light p-2 shadow-card">
              {navigation.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={closeMobileMenu}
                  className="block rounded-control px-3 py-2 text-sm text-ink hover:bg-surface-strong hover:text-brand-600 transition-colors"
                >
                  {item.label}
                </Link>
              ))}
              {displayName ? (
                <button
                  onClick={() => { closeMobileMenu(); signOut(); }}
                  className="block w-full rounded-control px-3 py-2 text-left text-sm text-ink-weak hover:bg-surface-strong"
                >
                  Sign out ({displayName})
                </button>
              ) : null}
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
