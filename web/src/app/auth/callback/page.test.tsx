// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import AuthCallbackPage from "./page";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => search,
}));

const CODE = "a".repeat(64);
const SESSION = `header.${btoa(JSON.stringify({ userId: "u1", email: "oauth@example.com", displayName: null }))}.signature`;

let requests: { url: string; init: RequestInit }[];
let status: number;

function visit(query: string) {
  search = new URLSearchParams(query);
  window.history.replaceState(null, "", `/auth/callback?${query}`);
  render(<AuthCallbackPage />);
}

beforeEach(() => {
  requests = [];
  status = 200;
  localStorage.clear();
  router.replace.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url: String(url), init });
    return new Response(
      JSON.stringify(status === 200 ? { token: SESSION } : { error: "INVALID_CODE", detail: "expired" }),
      { status },
    );
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("OAuth callback", () => {
  it("swaps the one-time code for a session with a credentialed POST", async () => {
    visit(`code=${CODE}`);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toMatch(/\/auth\/exchange$/);
    expect(requests[0]!.init).toMatchObject({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ code: CODE }),
    });
    expect(localStorage.getItem("nanda_auth_token")).toBe(SESSION);
  });

  it("removes the code from the address bar and history straight away", () => {
    visit(`code=${CODE}`);
    expect(window.location.search).toBe("");
  });

  it("does not sign in when the server refuses the code", async () => {
    status = 400;
    visit(`code=${CODE}`);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login?error=invalid_token"));
    expect(localStorage.getItem("nanda_auth_token")).toBeNull();
  });

  it("never stores a token taken from the URL (login CSRF)", async () => {
    visit(`token=${SESSION}`);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login?error=invalid_token"));
    expect(requests).toHaveLength(0);
    expect(localStorage.getItem("nanda_auth_token")).toBeNull();
  });
});
