// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAuthToken } from "@/lib/auth";
import { ExploreActions } from "./ExploreActions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/explore",
}));

const SECONDS_PER_MINUTE = 60;

function sessionToken(expiresInSeconds: number) {
  const payload = {
    userId: "test",
    email: "test@example.com",
    displayName: "Test User",
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  };
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

function href(name: string) {
  return screen.getByRole("link", { name }).getAttribute("href");
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("ExploreActions account entry points", () => {
  it("offers sign-in and direct account creation while signed out", () => {
    render(<ExploreActions />);
    expect(href("Sign in")).toBe("/login");
    expect(href("Create account")).toBe("/login?mode=register");
    expect(screen.queryByRole("link", { name: /Dashboard/ })).toBeNull();
  });

  it("replaces both with the dashboard link while signed in", () => {
    setAuthToken(sessionToken(10 * SECONDS_PER_MINUTE));
    render(<ExploreActions />);
    expect(screen.getByRole("link", { name: /Dashboard/ }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Create account" })).toBeNull();
  });

  it("treats an expired session as signed out", () => {
    setAuthToken(sessionToken(-SECONDS_PER_MINUTE));
    render(<ExploreActions />);
    expect(href("Create account")).toBe("/login?mode=register");
    expect(screen.queryByRole("link", { name: /Dashboard/ })).toBeNull();
  });
});
