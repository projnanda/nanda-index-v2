"use client";

import Link from "next/link";
import { setAnalyticsConsent, useAnalyticsConsent } from "@/lib/consent";

/** Asks once whether analytics may load; hidden after a choice. */
export function ConsentBanner({ googleAnalytics, posthog }: { googleAnalytics: boolean; posthog: boolean }) {
  const tools = [googleAnalytics && "Google Analytics", posthog && "PostHog"].filter(Boolean).join(" and ");

  // undefined during server rendering, so the banner never flashes for
  // visitors who have already chosen.
  const consent = useAnalyticsConsent();

  if (consent !== null) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Analytics consent"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface-light px-4 py-4 shadow-card sm:px-6"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 text-sm text-ink-medium sm:flex-row sm:items-center sm:justify-between">
        <p>
          We&apos;d like to use {tools} to understand how the site is used
          {posthog && ", including recordings of page interactions with form inputs and personal details masked"}. Nothing
          loads unless you accept. <Link href="/privacy" className="underline hover:text-brand-600">Privacy</Link>
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => setAnalyticsConsent("denied")}
            className="h-9 rounded-control border-2 border-line bg-surface-light px-4 font-medium text-ink hover:border-line-strong"
          >
            Decline
          </button>
          <button
            onClick={() => setAnalyticsConsent("granted")}
            className="h-9 rounded-control bg-brand-500 px-4 font-medium text-white hover:bg-brand-600"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
