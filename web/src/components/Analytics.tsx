"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { isPrivatePath } from "@/lib/analyticsPrivacy";
import { onAnalyticsConsentChange, useAnalyticsConsent } from "@/lib/consent";

/**
 * Google Analytics, only after the visitor opts in (ConsentBanner), and
 * without ever sending a query string.
 *
 * The stock loader reported the full page URL, so a password-reset token
 * (/reset-password?token=…) or a session JWT (/auth/callback?token=…) went to
 * Google with the page view. Here GA only ever sees origin + path, and pages
 * that carry secrets in their URL don't load it at all.
 */

type Gtag = (...args: unknown[]) => void;

function gtag(...args: unknown[]): void {
  const fn = (window as unknown as { gtag?: Gtag }).gtag;
  if (fn) fn(...args);
}

function setGaDisabled(gaId: string, disabled: boolean): void {
  (window as unknown as Record<string, boolean>)[`ga-disable-${gaId}`] = disabled;
}

export function Analytics({ gaId }: { gaId: string }) {
  const pathname = usePathname() ?? "/";
  const isPrivate = isPrivatePath(pathname);
  const consent = useAnalyticsConsent();

  // GA's own opt-out flag stops a loaded gtag at once, without waiting for a
  // reload to unload the script: when the visitor declines after accepting,
  // and while a client-side navigation has them on a private page.
  useEffect(() => {
    setGaDisabled(gaId, isPrivate || consent !== "granted");
    return onAnalyticsConsentChange((value) => setGaDisabled(gaId, isPrivate || value !== "granted"));
  }, [gaId, isPrivate, consent]);

  const enabled = consent === "granted" && !isPrivate;

  useEffect(() => {
    if (!enabled) return;
    const pageLocation = window.location.origin + pathname;
    gtag("set", { page_location: pageLocation });
    gtag("event", "page_view", { page_location: pageLocation, page_path: pathname, page_title: document.title });
  }, [pathname, enabled]);

  if (!enabled) return null;

  const init = `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', ${JSON.stringify(gaId)}, {
      send_page_view: false,
      page_location: window.location.origin + window.location.pathname
    });
  `;

  return (
    <>
      <Script id="ga-init" strategy="afterInteractive">{init}</Script>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`} strategy="afterInteractive" />
    </>
  );
}
