// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ConsentBanner } from "./ConsentBanner";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

it("asks about analytics without naming the tools, which /privacy lists", () => {
  render(<ConsentBanner recordsSessions />);
  const banner = screen.getByRole("dialog", { name: "Analytics consent" });

  expect(banner.textContent).toContain("We'd like to use analytics to understand how the site is used");
  expect(banner.textContent).not.toMatch(/PostHog|Google Analytics/);
  expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
});

it("mentions recordings only when sessions are recorded", () => {
  const { rerender } = render(<ConsentBanner recordsSessions />);
  expect(screen.getByRole("dialog").textContent).toContain("recordings of page interactions with form inputs and personal details masked");

  rerender(<ConsentBanner recordsSessions={false} />);
  expect(screen.getByRole("dialog").textContent).not.toContain("recordings");
});

it("stays hidden once the visitor has chosen", () => {
  window.localStorage.setItem("nanda_analytics_consent", "denied");
  render(<ConsentBanner recordsSessions />);
  expect(screen.queryByRole("dialog")).toBeNull();
});
