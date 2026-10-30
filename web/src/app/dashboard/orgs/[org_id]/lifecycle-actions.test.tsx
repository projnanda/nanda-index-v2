// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrgDetailPage from "./page";
const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation, useParams: () => ({ org_id: "test-entry" }) }));
vi.mock("@/hooks/useRequireAuth", () => ({ useRequireAuth: () => {} }));
// jsdom does not implement the native dialog methods.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  navigation.replace.mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup(status = "active", failure = false) {
  const requests: string[] = [];
  const org = { org_id: "test-entry", display_name: "Test Entry", domain: null, registry_url: "https://example.com/card.json",
    ttl_seconds: 86400, status, email_verified: true, domain_verified: false, created_at: "2026-10-30T12:00:00Z", updated_at: "2026-10-30T12:00:00Z", identifier: "urn:air:host39.org:personal:lee@example.com", extensions: {} };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (init.method) {
      requests.push(`${init.method} ${url}`);
      return failure ? new Response(JSON.stringify({ error: "UNAVAILABLE", detail: "Please try again." }), { status: 503 })
        : new Response(init.method === "DELETE" ? null : JSON.stringify({ ...org, status: status === "active" ? "suspended" : "active" }), { status: init.method === "DELETE" ? 204 : 200 });
    }
    return new Response(JSON.stringify(org));
  });
  render(<OrgDetailPage />);
  return requests;
}

it("requires the exact identifier before deleting and explains that the handle becomes claimable", async () => {
  const requests = setup();
  await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
  const dialog = screen.getByRole("dialog", { name: "Delete entry" });
  expect(requests).toHaveLength(0);
  expect(within(dialog).getByText(/claimed by someone else/)).toBeTruthy();
  const confirm = within(dialog).getByRole("button", { name: "Delete entry" }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "TEST-ENTRY" } });
  expect(confirm.disabled).toBe(true);
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "test-entry" } });
  await userEvent.click(confirm);
  expect(requests).toEqual(["DELETE /api/v1/orgs/test-entry"]);
  expect(navigation.replace).toHaveBeenCalledWith("/dashboard");
});

it.each(["Suspend", "Reactivate"])("confirms %s in-page and cancel restores the original button", async (label) => {
  const requests = setup(label === "Suspend" ? "active" : "suspended");
  const opener = await screen.findByRole("button", { name: label });
  await userEvent.click(opener);
  const dialog = screen.getByRole("dialog", { name: `${label} entry` });
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(requests).toHaveLength(0);
  expect(document.activeElement).toBe(opener);
  await userEvent.click(opener);
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: `${label} entry` }));
  expect(requests).toHaveLength(1);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("leaves a failed action visible in the dialog for retry", async () => {
  setup("active", true);
  await userEvent.click(await screen.findByRole("button", { name: "Suspend" }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Suspend entry" }));
  expect(await within(screen.getByRole("dialog")).findByRole("alert")).toBeTruthy();
  expect((within(screen.getByRole("dialog")).getByRole("button", { name: "Suspend entry" }) as HTMLButtonElement).disabled).toBe(false);
});
