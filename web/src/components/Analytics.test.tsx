// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/explore" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("next/script", () => ({ default: () => null }));

import { Analytics } from "./Analytics";

const GA_ID = "G-TEST";
const isDisabled = () => (window as unknown as Record<string, boolean | undefined>)[`ga-disable-${GA_ID}`];

function show(pathname: string) {
  navigation.pathname = pathname;
  return <Analytics gaId={GA_ID} />;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

it("disables GA on client-side navigation into a private page and re-enables it on leaving", () => {
  window.localStorage.setItem("nanda_analytics_consent", "granted");
  const { rerender } = render(show("/explore"));
  expect(isDisabled()).toBe(false);

  rerender(show("/login"));
  expect(isDisabled()).toBe(true);

  rerender(show("/explore"));
  expect(isDisabled()).toBe(false);
});

it("keeps GA disabled on public pages without consent", () => {
  window.localStorage.setItem("nanda_analytics_consent", "denied");
  render(show("/explore"));
  expect(isDisabled()).toBe(true);
});
