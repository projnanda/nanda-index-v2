import { describe, expect, it } from "vitest";
import { DEFAULT_POSTHOG_HOST, configuredPostHogHost, posthogHosts } from "./posthogHosts";

describe("posthogHosts", () => {
  it("maps PostHog US Cloud to its assets and app hosts", () => {
    expect(posthogHosts("https://us.i.posthog.com")).toEqual({
      api: "https://us.i.posthog.com",
      assets: "https://us-assets.i.posthog.com",
      ui: "https://us.posthog.com",
    });
  });

  it("maps PostHog EU Cloud to its assets and app hosts", () => {
    expect(posthogHosts("https://eu.i.posthog.com/")).toEqual({
      api: "https://eu.i.posthog.com",
      assets: "https://eu-assets.i.posthog.com",
      ui: "https://eu.posthog.com",
    });
  });

  it("serves everything from a self-hosted instance's own host", () => {
    expect(posthogHosts("https://posthog.example.org/")).toEqual({
      api: "https://posthog.example.org",
      assets: "https://posthog.example.org",
      ui: "https://posthog.example.org",
    });
  });
});

describe("configuredPostHogHost", () => {
  it("uses the configured host", () => {
    expect(configuredPostHogHost("https://eu.i.posthog.com")).toBe("https://eu.i.posthog.com");
  });

  // The Dockerfile passes an empty string when the build arg is missing.
  it.each([undefined, "", "  "])("falls back to the default for %j", (value) => {
    expect(configuredPostHogHost(value)).toBe(DEFAULT_POSTHOG_HOST);
  });
});
