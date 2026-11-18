// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExplorePage from "./page";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/dashboard",
}));

const SESSION = `header.${btoa(JSON.stringify({ userId: "u1", email: "header@example.com", displayName: "Header User", exp: 1900000000 }))}.signature`;

let requests: { url: string; init?: RequestInit }[];
let status: number;

beforeEach(() => {
  requests = [];
  status = 200;
  router.push.mockReset();
  localStorage.clear();
  localStorage.setItem("nanda_auth_token", SESSION);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    if (String(url).includes("/api/v1/index?")) return new Response("[]", { status: 200 });
    return new Response(JSON.stringify(status === 200 ? { ok: true } : { error: "UNAUTHORIZED" }), { status });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Explore account access", () => {
  it.each([null, `header.${btoa(JSON.stringify({ userId: "u1", email: "expired@example.com", exp: 1 }))}.signature`])("offers sign-in for absent or expired credentials", async (token) => {
    localStorage.clear();
    if (token) localStorage.setItem("nanda_auth_token", token);
    render(<ExplorePage />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login"));
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("offers the dashboard for a signed-in account", async () => {
    render(<ExplorePage />);
    await waitFor(() => expect(screen.getByRole("link", { name: /Header User/ }).getAttribute("href")).toBe("/dashboard"));
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });

  it("revokes the session on the server before forgetting it", async () => {
    const user = userEvent.setup();
    render(<ExplorePage />);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/"));
    const logout = requests.find((r) => r.url.endsWith("/auth/logout"));
    expect(logout?.init?.method).toBe("POST");
    expect(logout?.init?.headers).toMatchObject({ Authorization: `Bearer ${SESSION}` });
    expect(localStorage.getItem("nanda_auth_token")).toBeNull();
  });

  it("still signs out locally when the server cannot be reached", async () => {
    status = 500;
    const user = userEvent.setup();
    render(<ExplorePage />);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/"));
    expect(localStorage.getItem("nanda_auth_token")).toBeNull();
  });
});
