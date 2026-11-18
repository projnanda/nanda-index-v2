"use client";

import { useRef } from "react";
import Link from "next/link";
import { navigation } from "@/lib/site-data";

export function Header() {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  function closeMobileMenu() {
    if (detailsRef.current) detailsRef.current.open = false;
  }

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
          </span>
        </Link>

        {/* Navigation */}
        <div className="flex items-center gap-6">
          <nav aria-label="Main navigation" className="hidden items-center gap-6 lg:flex">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm font-medium text-ink-medium hover:text-brand-600 transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <details ref={detailsRef} className="relative lg:hidden">
            <summary className="cursor-pointer list-none rounded-control border-2 border-line bg-surface-light px-3 py-1.5 text-sm font-medium text-ink hover:border-line-strong transition">
              Menu
            </summary>

            <nav aria-label="Mobile navigation" className="absolute right-0 mt-2 w-56 rounded-card border border-line bg-surface-light p-2 shadow-card">
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
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
