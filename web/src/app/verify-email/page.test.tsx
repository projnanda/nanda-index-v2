// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VerifyEmailPage from "./page";

let search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => search }));
const org = {
  org_id: "email-entry", display_name: "Email Entry", domain: "example.com",
  registry_url: "https://example.com/card.json", ttl_seconds: 86400, status: "pending",
  email_verified: true, domain_verified: false, created_at: "2026-10-30T12:00:00Z",
  updated_at: "2026-10-30T12:00:00Z", identifier: "urn:air:example.com:agent:email-entry", extensions: {},
};
let requests: RequestInit[];
let result: unknown;
let status: number;
beforeEach(() => {
  search = new URLSearchParams("token=email-verification-token");
  window.history.replaceState(null, "", "/verify-email?token=email-verification-token");
  requests = [];
  result = org;
  status = 200;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    requests.push(init);
    return new Response(JSON.stringify(result), { status });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("email verification", () => {
  it("waits for explicit confirmation and removes the secret from browser history", async () => {
    const user = userEvent.setup();
    render(<VerifyEmailPage />);
    expect(requests).toHaveLength(0);
    expect(window.location.search).toBe("");
    await user.click(screen.getByRole("button", { name: "Verify email" }));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "POST", body: JSON.stringify({ token: "email-verification-token" }) });
    expect(await screen.findByRole("heading", { name: "Your email is confirmed" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to the dashboard" }).getAttribute("href")).toBe("/dashboard/orgs/email-entry");
    expect(screen.getByText(/Next, verify your domain/)).toBeTruthy();
  });

  it("does not direct suspended or personal entries to nonexistent domain verification", async () => {
    result = { ...org, status: "suspended", domain: null };
    render(<VerifyEmailPage />);
    await userEvent.click(screen.getByRole("button", { name: "Verify email" }));
    await screen.findByRole("heading", { name: "Your email is confirmed" });
    expect(screen.queryByText(/Next, verify your domain/)).toBeNull();
    expect(screen.getByRole("link", { name: "Go to the dashboard" })).toBeTruthy();
  });

  it("provides an actionable dashboard link after an expired or consumed link", async () => {
    status = 404;
    result = { error: "NOT_FOUND" };
    render(<VerifyEmailPage />);
    await userEvent.click(screen.getByRole("button", { name: "Verify email" }));
    expect(await screen.findByText(/expired or was already used/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Check verification or send a new link" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByRole("button", { name: "Verify email" })).toBeNull();
    expect(screen.queryByText(/Press the button to confirm/)).toBeNull();
  });

  it("allows another confirmation attempt after a temporary failure", async () => {
    status = 503;
    result = { error: "temporarily_unavailable" };
    render(<VerifyEmailPage />);
    await userEvent.click(screen.getByRole("button", { name: "Verify email" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(requests).toHaveLength(1);

    status = 200;
    result = org;
    await userEvent.click(screen.getByRole("button", { name: "Verify email" }));
    expect(await screen.findByRole("heading", { name: "Your email is confirmed" })).toBeTruthy();
    expect(requests).toHaveLength(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("gives a neutral recovery state on refresh after the token was removed", () => {
    search = new URLSearchParams();
    render(<VerifyEmailPage />);
    expect(screen.getByRole("heading", { name: "Check email verification" })).toBeTruthy();
    expect(screen.queryByText(/invalid or incomplete/)).toBeNull();
    expect(screen.getByRole("link", { name: "dashboard" })).toBeTruthy();
    expect(requests).toHaveLength(0);
  });
});
