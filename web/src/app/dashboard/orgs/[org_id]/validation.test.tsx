// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

it("holds the submitted edit values until a delayed validation response returns", async () => {
  let complete!: (response: Response) => void;
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => init.method
    ? new Promise<Response>((resolve) => { complete = resolve; })
    : Promise.resolve(new Response(JSON.stringify(org))));
  render(<OrgDetailPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
  const url = screen.getByLabelText(/^Catalog \/ Agent Card URL/) as HTMLInputElement;
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await userEvent.type(url, "?changed=true");
  expect(url.value).toBe(org.registry_url);
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  await act(async () => { complete(new Response(JSON.stringify({ error: "VALIDATION", field: "registry_url", detail: "registry_url must start with https://" }), { status: 400 })); });
  expect(url.getAttribute("aria-invalid")).toBe("true");
  await userEvent.type(url, "?corrected=true");
  expect(url.value).toBe(`${org.registry_url}?corrected=true`);
  expect(url.getAttribute("aria-invalid")).toBe("false");
});
