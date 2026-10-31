// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewOrgPage from "./page";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), back: vi.fn() }) }));
vi.mock("@/hooks/useRequireAuth", () => ({ useRequireAuth: () => {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("guides a personal registration with a handle, live public identity and optional advanced settings", async () => {
  const user = userEvent.setup();
  let submitted: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.includes("availability")) return new Response(JSON.stringify({ org_id_available: true }));
    submitted = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ ...submitted, identifier: "urn:air:host39.org:personal:lee@example.com", domain: null, status: "pending", extensions: {} }), { status: 201 });
  });
  render(<NewOrgPage />);
  await user.click(screen.getByText(/Personal Agent/));
  fireEvent.change(screen.getByLabelText(/^Handle/), { target: { value: "lee-agent" } });
  fireEvent.change(screen.getByLabelText(/^Display Name/), { target: { value: "Lee" } });
  fireEvent.change(screen.getByLabelText(/^Email Identity/), { target: { value: "lee@example.com" } });
  expect(screen.getByText("urn:air:host39.org:personal:lee@example.com")).toBeTruthy();
  expect(screen.getByText(/This email address will be publicly visible/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Continue →" }));
  fireEvent.change(await screen.findByLabelText(/^Agent Card URL/), { target: { value: "https://example.com/card.json" } });
  const runtime = screen.getByText("Advanced runtime and authentication").closest("details")!;
  expect(runtime.open).toBe(false);
  await user.click(screen.getByText("Advanced runtime and authentication"));
  expect(runtime.open).toBe(true);
  await user.click(screen.getByRole("button", { name: "Continue →" }));
  expect(screen.getByText(/This email address will be publicly visible/)).toBeTruthy();
  expect(screen.getByLabelText(/^Cache TTL/).closest("details")!.open).toBe(false);
  await user.click(screen.getByRole("button", { name: "Register" }));
  await screen.findByRole("heading", { name: "Registered", level: 2 });
  expect(submitted).toMatchObject({ org_id: "lee-agent", contact_email: "lee@example.com", ttl_seconds: 86400, hosting_path: "personal" });
  expect(screen.getByText(/Your account email confirms/)).toBeTruthy();
  expect(screen.getByRole("link", { name: /View your entry/ })).toBeTruthy();
});
