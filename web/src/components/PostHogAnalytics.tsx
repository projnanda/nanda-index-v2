"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import type { PostHog, PostHogConfig } from "posthog-js";
import { isPrivatePath, scrubEvent, scrubNetworkRequest, scrubReplayAttribute, scrubReplayText } from "@/lib/analyticsPrivacy";
import { useAnalyticsConsent } from "@/lib/consent";

/**
 * PostHog product analytics and session replay, under the same consent as
 * Google Analytics (ConsentBanner) and the same rule that no URL secret
 * leaves the browser (lib/analyticsPrivacy.ts).
 *
 * posthog-js is only downloaded once the visitor accepts, and never starts
 * on a private page; events are anonymous (no identify, no person profiles).
 * Replays show the public page content but mask every input, every email
 * address and anything marked with REPLAY_MASK_CLASS. Traffic goes through
 * this site's /ingest rewrite (next.config.ts), so the CSP stays 'self'.
 */

const OPTIONS: Partial<PostHogConfig> = {
  api_host: "/ingest",
  defaults: "2026-08-30",
  person_profiles: "never",
  capture_pageview: "history_change",
  // While on a private page, drop everything, including replay batches that
  // only flush after the visitor has navigated away again.
  before_send: (event) => (onPrivatePage ? null : scrubEvent(event, window.location.pathname)),
  session_recording: {
    maskAllInputs: true,
    // Route every text node through scrubReplayText, which redacts only
    // personal data; without maskTextFn this selector would star out all text.
    maskTextSelector: "*",
    maskTextFn: scrubReplayText,
    maskAttributeFn: scrubReplayAttribute,
    recordHeaders: false,
    recordBody: false,
    maskCapturedNetworkRequestFn: scrubNetworkRequest,
  },
};

let loading: Promise<PostHog> | null = null;
// Set while a client-side navigation has a loaded PostHog on a private page.
let onPrivatePage = false;

function loadPostHog(): Promise<PostHog> {
  loading ??= import("posthog-js").then((module) => module.default);
  return loading;
}

export function PostHogAnalytics({ apiKey, uiHost }: { apiKey: string; uiHost: string }) {
  const pathname = usePathname() ?? "/";
  const isPrivate = isPrivatePath(pathname);
  const consent = useAnalyticsConsent();

  useEffect(() => {
    if (consent === undefined) return; // server render: the choice isn't known yet
    let stale = false;

    if (consent !== "granted") {
      // Declining after accepting stops capture and replay at once, and
      // PostHog drops its cookie/localStorage persistence with it.
      loading?.then((posthog) => {
        if (!stale && posthog.__loaded) posthog.opt_out_capturing();
      });
    } else if (isPrivate) {
      // Navigated here from a public page: posthog-js stays in memory, so
      // pause capture and replay until the visitor leaves.
      loading?.then((posthog) => {
        if (stale || !posthog.__loaded || onPrivatePage) return;
        onPrivatePage = true;
        posthog.stopSessionRecording();
      });
    } else {
      loadPostHog()
        .then((posthog) => {
          if (stale) return;
          if (!posthog.__loaded) posthog.init(apiKey, { ...OPTIONS, ui_host: uiHost });
          // A previous decline in this browser persisted PostHog's own opt-out.
          if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing({ captureEventName: false });
          if (onPrivatePage) {
            onPrivatePage = false;
            posthog.startSessionRecording();
          }
        })
        .catch(() => {
          loading = null; // blocked or offline: try again on the next navigation
        });
    }

    return () => {
      stale = true;
    };
  }, [apiKey, uiHost, consent, isPrivate]);

  return null;
}
