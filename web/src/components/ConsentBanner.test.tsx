// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ConsentBanner } from "./ConsentBanner";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const bannerText = () => screen.getByRole("dialog", { name: "Analytics consent" }).textContent;

it("names Google Analytics and describes PostHog as session recordings", () => {
  render(<ConsentBanner googleAnalytics recordsSessions />);

  expect(bannerText()).toContain(
    "We'd like to use Google Analytics and session recordings to understand how the site is used, with form inputs and personal details masked in recordings.",
  );
  expect(bannerText()).not.toContain("PostHog");
  expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
});

it("mentions only Google Analytics when sessions are not recorded", () => {
  render(<ConsentBanner googleAnalytics recordsSessions={false} />);

  expect(bannerText()).toContain("We'd like to use Google Analytics to understand how the site is used.");
  expect(bannerText()).not.toContain("recordings");
});

it("mentions only session recordings when Google Analytics is off", () => {
  render(<ConsentBanner googleAnalytics={false} recordsSessions />);

  expect(bannerText()).toContain(
    "We'd like to use session recordings to understand how the site is used, with form inputs and personal details masked in recordings.",
  );
  expect(bannerText()).not.toContain("Google Analytics");
});

it("stays hidden once the visitor has chosen", () => {
  window.localStorage.setItem("nanda_analytics_consent", "denied");
  render(<ConsentBanner googleAnalytics recordsSessions />);
  expect(screen.queryByRole("dialog")).toBeNull();
});
