// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewOrgPage from "./page";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), back: vi.fn() }) }));
vi.mock("@/hooks/useRequireAuth", () => ({ useRequireAuth: () => {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("uses the shared URL validation before leaving the catalog step", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ org_id_available: true, domain_available: true })));
  render(<NewOrgPage />);
  fireEvent.change(screen.getByLabelText(/^Org ID/), { target: { value: "validation-entry" } });
  fireEvent.change(screen.getByLabelText(/^Display Name/), { target: { value: "Valid Entry" } });
  fireEvent.change(screen.getByLabelText(/^Domain/), { target: { value: "example.com" } });
  await userEvent.click(screen.getByRole("button", { name: "Continue →" }));
  const url = await screen.findByLabelText(/^AI Catalog Hosted URL/);
  fireEvent.change(url, { target: { value: "https://?" } });
  await userEvent.click(screen.getByRole("button", { name: "Continue →" }));
  expect(url.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(url.getAttribute("aria-describedby")!)!.textContent).toBe("Enter a valid URL starting with http:// or https://.");
  expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
});

it("keeps a server TTL validation error on the contact step and associates it with the select", async () => {
  vi.stubGlobal("fetch", async (url: string) => url.includes("availability")
    ? new Response(JSON.stringify({ org_id_available: true, domain_available: true }))
    : new Response(JSON.stringify({ error: "VALIDATION", field: "ttl_seconds", detail: "ttl_seconds must be at most 604800" }), { status: 400 }));
  render(<NewOrgPage />);
  fireEvent.change(screen.getByLabelText(/^Org ID/), { target: { value: "validation-entry" } });
  fireEvent.change(screen.getByLabelText(/^Display Name/), { target: { value: "Valid Entry" } });
  fireEvent.change(screen.getByLabelText(/^Domain/), { target: { value: "example.com" } });
  await userEvent.click(screen.getByRole("button", { name: "Continue →" }));
  fireEvent.change(await screen.findByLabelText(/^AI Catalog Hosted URL/), { target: { value: "https://example.com/catalog.json" } });
  await userEvent.click(screen.getByRole("button", { name: "Continue →" }));
  fireEvent.change(screen.getByLabelText(/^Contact Email/), { target: { value: "owner@example.com" } });
  await userEvent.click(screen.getByRole("button", { name: "Register" }));
  const ttl = await screen.findByLabelText(/^Cache TTL/);
  expect(ttl.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(ttl.getAttribute("aria-describedby")!)!.textContent).toMatch(/Cache TTL/);
});

it("ignores a delayed server field error after the registration form has changed", async () => {
  let complete!: (response: Response) => void;
  vi.stubGlobal("fetch", (url: string) => url.includes("availability")
    ? Promise.resolve(new Response(JSON.stringify({ org_id_available: true, domain_available: true })))
    : new Promise<Response>((resolve) => { complete = resolve; }));
  render(<NewOrgPage />);
  fireEvent.change(screen.getByLabelText(/^Org ID/), { target: { value: "validation-entry" } });
  fireEvent.change(screen.getByLabelText(/^Display Name/), { target: { value: "Valid Entry" } });
  fireEvent.change(screen.getByLabelText(/^Domain/), { target: { value: "example.com" } });
  await userEvent.click(screen.getByRole("button", { name: "Continue →" }));
  fireEvent.change(await screen.findByLabelText(/^AI Catalog Hosted URL/), { target: { value: "https://example.com/catalog.json" } });
  await userEvent.click(screen.getByRole("button", { name: "Continue →" }));
  fireEvent.change(screen.getByLabelText(/^Contact Email/), { target: { value: "owner@example.com" } });
  await userEvent.click(screen.getByRole("button", { name: "Register" }));
  await userEvent.click(screen.getByRole("button", { name: "← Back" }));
  fireEvent.change(screen.getByLabelText(/^AI Catalog Hosted URL/), { target: { value: "https://corrected.example.com/catalog.json" } });
  await act(async () => { complete(new Response(JSON.stringify({ error: "VALIDATION", field: "registry_url", detail: "registry_url must start with https://" }), { status: 400 })); });
  const url = screen.getByLabelText(/^AI Catalog Hosted URL/) as HTMLInputElement;
  expect(url.value).toBe("https://corrected.example.com/catalog.json");
  expect(url.getAttribute("aria-invalid")).toBe("false");
  expect(screen.queryByText("Enter a valid URL starting with http:// or https://.")).toBeNull();
});
