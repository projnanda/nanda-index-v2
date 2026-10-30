// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrgDetailPage from "./page";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), useParams: () => ({ org_id: "validation-entry" }) }));
vi.mock("@/hooks/useRequireAuth", () => ({ useRequireAuth: () => {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const org = { org_id: "validation-entry", display_name: "Valid Entry", domain: null, registry_url: "https://example.com/card.json", ttl_seconds: 86400, status: "active", email_verified: true, domain_verified: false, identifier: "urn:air:host39.org:personal:lee@example.com", created_at: "2026-10-30T12:00:00Z", updated_at: "2026-10-30T12:00:00Z", extensions: {} };

it("blocks invalid URLs inline before sending edits", async () => {
  let writes = 0;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => { if (init.method) writes++; return new Response(JSON.stringify(org)); });
  render(<OrgDetailPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
  const url = screen.getByLabelText(/^Catalog \/ Agent Card URL/);
  fireEvent.change(url, { target: { value: "https://" } });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(writes).toBe(0);
  expect(url.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(url.getAttribute("aria-describedby")!)!.textContent).toMatch(/valid URL/);
});
it("attributes legacy API validation details to the input without showing error codes", async () => {
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => init.method
    ? new Response(JSON.stringify({ error: "VALIDATION", detail: "registry_url must start with https://" }), { status: 400 })
    : new Response(JSON.stringify(org)));
  render(<OrgDetailPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  const url = screen.getByLabelText(/^Catalog \/ Agent Card URL/);
  expect(url.getAttribute("aria-invalid")).toBe("true");
  expect(screen.queryByText(/VALIDATION/)).toBeNull();
});
it("validates advanced runtime URL and TTL before saving", async () => {
  let writes = 0;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => { if (init.method) writes++; return new Response(JSON.stringify(org)); });
  render(<OrgDetailPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
  await userEvent.click(screen.getByText("Advanced settings"));
  fireEvent.change(screen.getByLabelText(/^Runtime URL/), { target: { value: "javascript:alert(1)" } });
  fireEvent.change(screen.getByLabelText(/^Cache TTL/), { target: { value: "3599" } });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(writes).toBe(0);
  expect(screen.getByLabelText(/^Runtime URL/).getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByLabelText(/^Cache TTL/).getAttribute("aria-invalid")).toBe("true");
});
