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
    <header className="sticky top-0 z-50 border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)]/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        {/* Brand tile + wordmark */}
        <Link href="/" className="flex min-w-0 items-center">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-card)] bg-[color:var(--color-primary-deep)] text-sm font-semibold tracking-wide text-white">
            NI
          </span>
          <span
            aria-hidden="true"
            className="mx-3 hidden h-6 w-px bg-[color:var(--color-border)] sm:block"
          />
          <span className="hidden min-w-0 flex-col leading-tight sm:flex">
            <span className="truncate text-base font-semibold text-[color:var(--color-fg-strong)]">
              Nanda Index
            </span>
            <span className="truncate text-xs text-[color:var(--color-fg-weak)]">
              Agent identity &amp; discovery
            </span>
          </span>
        </Link>

        {/* Primary nav */}
        <nav className="ml-auto hidden items-center gap-6 text-sm font-medium text-[color:var(--color-fg-default)] lg:flex">
          {publicNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="transition-colors hover:text-[color:var(--color-primary)]"
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
                className="flex items-center gap-2 text-sm text-[color:var(--color-fg-default)] transition-colors hover:text-[color:var(--color-primary)]"
              >
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[color:var(--color-primary-soft)] text-xs font-semibold text-[color:var(--color-primary-deep)]">
                  {userInitial}
                </span>
                <span className="truncate max-w-[12rem]">{displayName}</span>
              </Link>
              <button
                onClick={signOut}
                className="text-xs text-[color:var(--color-fg-weak)] hover:text-[color:var(--color-fg-default)] transition-colors"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="inline-flex h-9 items-center rounded-[var(--radius-control)] bg-[color:var(--color-primary)] px-4 text-sm font-medium text-white transition-colors hover:bg-[color:var(--color-primary-hover)]"
            >
              Sign in
            </Link>
          )}
        </div>

        <details ref={detailsRef} className="relative ml-auto lg:hidden">
          <summary className="cursor-pointer list-none rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[color:var(--color-fg-default)]">
            Menu
          </summary>

          <div className="absolute right-0 mt-2 w-56 rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-2 shadow-[var(--shadow-card)]">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMobileMenu}
                className="block rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium text-[color:var(--color-fg-default)] transition-colors hover:bg-[color:var(--color-surface-2)] hover:text-[color:var(--color-primary)]"
              >
                {item.label}
              </Link>
            ))}
            {displayName ? (
              <button
                onClick={() => { closeMobileMenu(); signOut(); }}
                className="block w-full rounded-[var(--radius-control)] px-3 py-2 text-left text-sm text-[color:var(--color-fg-weak)] hover:bg-[color:var(--color-surface-2)]"
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
