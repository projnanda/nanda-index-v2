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

  return (
    <header className="sticky top-0 z-50 border-b border-black/5 bg-[color:var(--page-bg)]/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-sm border border-black/10 bg-white px-3 text-sm font-semibold tracking-[0.28em] text-slate-900 shadow-sm">
            NI
          </span>
          <span className="hidden truncate font-serif text-lg italic tracking-tight text-slate-950 sm:block">
            Nanda Index
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-7 text-[0.72rem] uppercase tracking-[0.22em] text-slate-600 lg:flex">
          {publicNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="transition-colors hover:text-slate-950"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Auth button */}
        <div className="hidden lg:block">
          {displayName ? (
            <div className="flex items-center gap-3">
              <Link
                href="/dashboard"
                className="text-[0.72rem] uppercase tracking-[0.22em] text-slate-600 transition-colors hover:text-slate-950"
              >
                {displayName}
              </Link>
              <button
                onClick={signOut}
                className="rounded-full border border-black/10 bg-white px-3 py-1 text-[0.72rem] uppercase tracking-[0.22em] text-slate-500 hover:bg-slate-50"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-full border border-black/10 bg-white px-4 py-2 text-[0.72rem] font-medium uppercase tracking-[0.22em] text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Sign in
            </Link>
          )}
        </div>

        <details ref={detailsRef} className="relative ml-auto lg:hidden">
          <summary className="cursor-pointer list-none border border-black/10 bg-white px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-700 shadow-sm">
            Menu
          </summary>

          <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-black/10 bg-white p-2 shadow-lg">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMobileMenu}
                className="block rounded-xl px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950"
              >
                {item.label}
              </Link>
            ))}
            {displayName ? (
              <button
                onClick={() => { closeMobileMenu(); signOut(); }}
                className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50"
              >
                Sign out ({displayName})
              </button>
            ) : null}
          </div>
        </details>
      </div>
    </header>
  );
}
