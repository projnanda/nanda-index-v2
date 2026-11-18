// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrgDetailPage from "./page";
const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation, useParams: () => ({ org_id: "test-entry" }) }));
vi.mock("@/hooks/useRequireAuth", () => ({ useRequireAuth: () => {} }));
// jsdom does not implement the native dialog methods.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () {
    if (!this.open) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  navigation.replace.mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup(status = "active", failure = false, responses: Promise<Response>[] = [], strict = false) {
  const requests: string[] = [];
  const org = { org_id: "test-entry", display_name: "Test Entry", domain: null, registry_url: "https://example.com/card.json",
    ttl_seconds: 86400, status, email_verified: true, domain_verified: false, created_at: "2026-10-30T12:00:00Z", updated_at: "2026-10-30T12:00:00Z", identifier: "urn:air:host39.org:personal:lee@example.com", extensions: {} };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (init.method) {
      requests.push(`${init.method} ${url}`);
      const response = responses.shift();
      if (response) return response;
      const isDelete = init.method === "DELETE" && !url.endsWith("/suspend");
      return failure ? new Response(JSON.stringify({ error: "UNAVAILABLE", detail: "Please try again." }), { status: 503 })
        : new Response(isDelete ? null : JSON.stringify({ ...org, status: status === "active" ? "suspended" : "active" }), { status: isDelete ? 204 : 200 });
    }
    return new Response(JSON.stringify(org));
  });
  render(strict ? <StrictMode><OrgDetailPage /></StrictMode> : <OrgDetailPage />);
  return requests;
}

function pendingResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

const unavailable = () => new Response(JSON.stringify({ error: "UNAVAILABLE", detail: "Please try again." }), { status: 503 });

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

it("synchronizes an idle native close and allows the same action to reopen", async () => {
  const requests = setup();
  const opener = await screen.findByRole("button", { name: "Suspend" });
  await userEvent.click(opener);
  const dialog = screen.getByRole("dialog") as HTMLDialogElement;

  act(() => dialog.close());

  expect(document.querySelector("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
  await userEvent.click(opener);
  expect(screen.getByRole("dialog", { name: "Suspend entry" })).toBeTruthy();
  expect(requests).toHaveLength(0);
});

it("reopens after native close while busy so failure and retry remain visible", async () => {
  const pending = pendingResponse();
  const requests = setup("active", false, [pending.promise]);
  await userEvent.click(await screen.findByRole("button", { name: "Suspend" }));
  const dialog = screen.getByRole("dialog") as HTMLDialogElement;
  await userEvent.click(within(dialog).getByRole("button", { name: "Suspend entry" }));

  act(() => {
    dialog.dispatchEvent(new Event("cancel", { cancelable: false }));
    dialog.close();
  });

  expect(dialog.open).toBe(true);
  expect((within(dialog).getByRole("button", { name: "Working…" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => pending.resolve(unavailable()));
  expect(await within(screen.getByRole("dialog")).findByRole("alert")).toBeTruthy();
  await userEvent.click(within(dialog).getByRole("button", { name: "Suspend entry" }));
  expect(requests).toHaveLength(2);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps a native close in the submit turn from hiding the pending action", async () => {
  const pending = pendingResponse();
  setup("active", false, [pending.promise]);
  await userEvent.click(await screen.findByRole("button", { name: "Suspend" }));
  const dialog = screen.getByRole("dialog") as HTMLDialogElement;

  act(() => {
    dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    dialog.close();
  });

  expect(dialog.open).toBe(true);
  await act(async () => pending.resolve(unavailable()));
  expect(await within(screen.getByRole("dialog")).findByRole("alert")).toBeTruthy();
});

it("keeps a failure visible when it arrives before the queued native close event", async () => {
  const pending = pendingResponse();
  setup("active", false, [pending.promise]);
  await userEvent.click(await screen.findByRole("button", { name: "Suspend" }));
  const dialog = screen.getByRole("dialog") as HTMLDialogElement;
  await userEvent.click(within(dialog).getByRole("button", { name: "Suspend entry" }));

  // Native close removes open immediately, then queues the close event.
  dialog.removeAttribute("open");
  await act(async () => pending.resolve(unavailable()));

  expect(dialog.open).toBe(true);
  fireEvent(dialog, new Event("close"));
  expect(within(screen.getByRole("dialog")).getByRole("alert")).toBeTruthy();
});

it.each(["Suspend", "Reactivate"])("restores meaningful page focus after successful %s", async (label) => {
  setup(label === "Suspend" ? "active" : "suspended");
  await userEvent.click(await screen.findByRole("button", { name: label }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: `${label} entry` }));

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Danger Zone" }));
});

it.each(["Suspend", "Reactivate", "Delete"])("sends one %s request for same-turn submissions and permits retry after failure", async (label) => {
  const pending = pendingResponse();
  const requests = setup(label === "Reactivate" ? "suspended" : "active", false, [pending.promise]);
  await userEvent.click(await screen.findByRole("button", { name: label }));
  const dialog = screen.getByRole("dialog");
  if (label === "Delete") fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "test-entry" } });
  const form = dialog.querySelector("form")!;

  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  expect(requests).toHaveLength(1);
  await act(async () => pending.resolve(unavailable()));
  expect(await within(screen.getByRole("dialog")).findByRole("alert")).toBeTruthy();
  await userEvent.click(within(dialog).getByRole("button", { name: `${label} entry` }));
  expect(requests).toHaveLength(2);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("does not reopen a busy dialog during unmount cleanup", async () => {
  const pending = pendingResponse();
  setup("active", false, [pending.promise]);
  await userEvent.click(await screen.findByRole("button", { name: "Suspend" }));
  const dialog = screen.getByRole("dialog") as HTMLDialogElement;
  await userEvent.click(within(dialog).getByRole("button", { name: "Suspend entry" }));

  cleanup();

  expect(dialog.open).toBe(false);
  await act(async () => pending.resolve(unavailable()));
});

it("ignores a queued native close event after StrictMode has reopened the dialog", async () => {
  const requests = setup("active", false, [], true);
  await userEvent.click(await screen.findByRole("button", { name: "Suspend" }));
  const dialog = screen.getByRole("dialog") as HTMLDialogElement;

  // Real close() queues this event; StrictMode may have reopened the node first.
  fireEvent(dialog, new Event("close"));

  expect(dialog.open).toBe(true);
  expect(screen.getByRole("dialog", { name: "Suspend entry" })).toBe(dialog);
  expect(requests).toHaveLength(0);
});
