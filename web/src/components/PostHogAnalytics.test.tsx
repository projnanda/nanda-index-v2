// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CaptureResult, PostHogConfig } from "posthog-js";

const navigation = vi.hoisted(() => ({ pathname: "/explore" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

const posthog = vi.hoisted(() => ({
  __loaded: false,
  config: null as Partial<PostHogConfig> | null,
  init: vi.fn(),
  has_opted_out_capturing: vi.fn(() => false),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  stopSessionRecording: vi.fn(),
  startSessionRecording: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: posthog }));

import { PostHogAnalytics } from "./PostHogAnalytics";

const pageview = (): CaptureResult => ({ uuid: "0190-test", event: "$pageview", properties: {} });
const beforeSend = (event: CaptureResult) => (posthog.config!.before_send as (e: CaptureResult) => CaptureResult | null)(event);

function show(pathname: string) {
  navigation.pathname = pathname;
  return <PostHogAnalytics apiKey="phc_test" uiHost="https://us.posthog.com" />;
}

beforeEach(() => {
  window.localStorage.setItem("nanda_analytics_consent", "granted");
  posthog.init.mockImplementation((_key: string, config: Partial<PostHogConfig>) => {
    posthog.__loaded = true;
    posthog.config = config;
  });
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

it("stops replay and drops events after client-side navigation into a private page, and resumes on leaving", async () => {
  const { rerender } = render(show("/explore"));
  await waitFor(() => expect(posthog.init).toHaveBeenCalledTimes(1));
  expect(beforeSend(pageview())).not.toBeNull();

  rerender(show("/dashboard/orgs/1"));
  await waitFor(() => expect(posthog.stopSessionRecording).toHaveBeenCalledTimes(1));
  // Even a batch flushed once the URL no longer looks private is dropped.
  expect(beforeSend(pageview())).toBeNull();

  rerender(show("/explore"));
  await waitFor(() => expect(posthog.startSessionRecording).toHaveBeenCalledTimes(1));
  expect(beforeSend(pageview())).not.toBeNull();
  expect(posthog.init).toHaveBeenCalledTimes(1);
});
