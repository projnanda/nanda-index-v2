// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewOrgPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), back: vi.fn() }) }));
vi.mock("@/hooks/useRequireAuth", () => ({ useRequireAuth: () => {} }));
const record = {
  org_id: "test-agent", display_name: "Test Agent", domain: "test.example.com",
  registry_url: "https://test.example.com/card.json", ttl_seconds: 86400, status: "pending",
  email_verified: false, domain_verified: false, created_at: "2026-10-30T12:00:00Z",
  updated_at: "2026-10-30T12:00:00Z", identifier: "urn:air:test.example.com:agent:test-agent", extensions: {},
};
let response: unknown;
beforeEach(() => {
  response = record;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
    url.includes("availability") ? { org_id_available: true, domain_available: true } : response,
  ), { status: url.includes("availability") ? 200 : 201 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function register(path: "registry" | "dns-svcb" | "smb" | "personal") {
  const user = userEvent.setup();
  render(<NewOrgPage />);
  if (path !== "registry") {
    await user.click(screen.getByText(path === "personal" ? /Personal Agent/ : path === "smb" ? /SMB Agent Card/ : /^DNS SVCB/));
  }
  fireEvent.change(screen.getByLabelText(/^(Org ID|Handle)/), { target: { value: "test-agent" } });
  fireEvent.change(screen.getByLabelText(/^Display Name/), { target: { value: "Test Agent" } });
  fireEvent.change(screen.getByLabelText(path === "personal" ? /^Email Identity/ : /^Domain/), {
    target: { value: path === "personal" ? "test@example.com" : "test.example.com" },
  });
  await user.click(screen.getByRole("button", { name: "Continue →" }));
  fireEvent.change(await screen.findByLabelText(path === "registry" ? /^AI Catalog Hosted URL/ : /^Agent Card URL/), {
    target: { value: "https://test.example.com/card.json" },
  });
  await user.click(screen.getByRole("button", { name: "Continue →" }));
  if (path !== "personal") fireEvent.change(screen.getByLabelText(/^Contact Email/), { target: { value: "test@example.com" } });
  await user.click(screen.getByRole("button", { name: "Register" }));
}

describe("registration completion", () => {
  it.each(["registry", "dns-svcb", "smb", "personal"] as const)("shows confirmation and onward links for %s", async (path) => {
    await register(path);
    expect(await screen.findByRole("heading", { name: "Registered", level: 2 })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to dashboard" }).getAttribute("href")).toBe("/dashboard");
  });

  it("keeps a saved registration recoverable if the success response cannot render", async () => {
    response = { ...record, identifier: { unexpected: "object" } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    await register("registry");
    expect(await screen.findByRole("link", { name: "Open your entry" })).toHaveProperty("pathname", "/dashboard/orgs/test-agent");
    expect(screen.getByText(/registration was saved/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
  });

  it("keeps the submitted identity when the form changes before the response arrives", async () => {
    let complete!: (response: Response) => void;
    vi.stubGlobal("fetch", (url: string) => url.includes("availability")
      ? Promise.resolve(new Response(JSON.stringify({ org_id_available: true, domain_available: true })))
      : new Promise<Response>((resolve) => { complete = resolve; }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await register("registry");
    await userEvent.click(screen.getByRole("button", { name: "← Back" }));
    await userEvent.click(screen.getByRole("button", { name: "← Back" }));
    fireEvent.change(screen.getByLabelText(/^(Org ID|Handle)/), { target: { value: "different-entry" } });
    await act(async () => { complete(new Response(JSON.stringify({ ...record, identifier: {} }), { status: 201 })); });
    expect(await screen.findByRole("link", { name: "Open your entry" })).toHaveProperty("pathname", "/dashboard/orgs/test-agent");
  });

  it("does not invite a duplicate submission after a 201 with an empty response", async () => {
    response = null;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await register("registry");
    expect(await screen.findByRole("link", { name: "Open your entry" })).toHaveProperty("pathname", "/dashboard/orgs/test-agent");
    expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
  });
});
