// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewOrgPage from "./page";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), back: vi.fn() }) }));
vi.mock("@/hooks/useRequireAuth", () => ({ useRequireAuth: () => {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function fillIdentity() {
  fireEvent.change(screen.getByLabelText(/^Org ID/), { target: { value: "test-entry" } });
  fireEvent.change(screen.getByLabelText(/^Display Name/), { target: { value: "Test Entry" } });
  fireEvent.change(screen.getByLabelText(/^Domain/), { target: { value: "test.example.com" } });
}
it("returns a late domain conflict to the identity field with form values intact", async () => {
  vi.stubGlobal("fetch", async (url: string) => url.includes("availability")
    ? new Response(JSON.stringify({ org_id_available: true, domain_available: true }))
    : new Response(JSON.stringify({ error: "CONFLICT", field: "domain", detail: 'domain "test.example.com" is already registered' }), { status: 409 }));
  render(<NewOrgPage />);
  fillIdentity();
  await userEvent.click(screen.getByRole("button", { name: "Continue →" }));
  fireEvent.change(await screen.findByLabelText(/^AI Catalog Hosted URL/), { target: { value: "https://test.example.com/catalog.json" } });
  await userEvent.click(screen.getByRole("button", { name: "Continue →" }));
  fireEvent.change(screen.getByLabelText(/^Contact Email/), { target: { value: "owner@example.com" } });
  await userEvent.click(screen.getByRole("button", { name: "Register" }));
  expect(await screen.findByRole("heading", { name: "Identity" })).toBeTruthy();
  const domain = screen.getByLabelText(/^Domain/) as HTMLInputElement;
  expect(domain.value).toBe("test.example.com");
  expect(domain.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText(/This domain is already registered/)).toBeTruthy();
});
it("checks availability on blur and ignores a result for an edited identity", async () => {
  const pending: ((response: Response) => void)[] = [];
  vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => pending.push(resolve)));
  render(<NewOrgPage />);
  fillIdentity();
  const domain = screen.getByLabelText(/^Domain/) as HTMLInputElement;
  fireEvent.blur(domain);
  expect(pending).toHaveLength(1);
  fireEvent.change(domain, { target: { value: "new.example.com" } });
  fireEvent.blur(domain);
  expect(pending).toHaveLength(2);
  await act(async () => { pending[1](new Response(JSON.stringify({ org_id_available: true, domain_available: true }))); });
  await act(async () => { pending[0](new Response(JSON.stringify({ org_id_available: true, domain_available: false }))); });
  expect(domain.getAttribute("aria-invalid")).not.toBe("true");
  expect(screen.queryByText(/already registered/)).toBeNull();
});
