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
  expect(ttl.closest("details")!.open).toBe(true);
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

async function startPendingRegistration() {
  let resolve!: (response: Response) => void;
  let reject!: (reason: unknown) => void;
  vi.stubGlobal("fetch", (url: string) => url.includes("availability")
    ? Promise.resolve(new Response(JSON.stringify({ org_id_available: true, domain_available: true })))
    : new Promise<Response>((done, fail) => { resolve = done; reject = fail; }));
  render(<NewOrgPage />);
  fireEvent.change(screen.getByLabelText(/^Org ID/), { target: { value: "validation-entry" } });
  fireEvent.change(screen.getByLabelText(/^Display Name/), { target: { value: "Valid Entry" } });
  fireEvent.change(screen.getByLabelText(/^Domain/), { target: { value: "example.com" } });
  await userEvent.click(screen.getByRole("button", { name: "Continue →" }));
  fireEvent.change(await screen.findByLabelText(/^AI Catalog Hosted URL/), { target: { value: "https://example.com/catalog.json" } });
  await userEvent.click(screen.getByRole("button", { name: "Continue →" }));
  fireEvent.change(screen.getByLabelText(/^Contact Email/), { target: { value: "owner@example.com" } });
  await userEvent.click(screen.getByRole("button", { name: "Register" }));
  return { resolve, reject };
}

it.each([
  { status: 403, error: "ACCOUNT_NOT_VERIFIED", detail: "verify your account email first", expected: /Verify your email to register and manage agents/ },
  { status: 429, error: "TOO_MANY_REQUESTS", detail: "Too many requests. Try again later.", expected: /Too many requests. Try again later/ },
  { status: 503, error: "UNAVAILABLE", detail: "Registration is temporarily unavailable.", expected: /Registration is temporarily unavailable/ },
])("shows a delayed $status failure even after another field is edited", async ({ status, error, detail, expected }) => {
  const pending = await startPendingRegistration();
  fireEvent.change(screen.getByLabelText(/^Contact Email/), { target: { value: "changed@example.com" } });
  await act(async () => pending.resolve(new Response(JSON.stringify({ error, detail }), { status })));
  expect(await screen.findByText(expected)).toBeTruthy();
  expect((screen.getByLabelText(/^Contact Email/) as HTMLInputElement).value).toBe("changed@example.com");
});

it("shows a delayed network failure after editing contact email", async () => {
  const pending = await startPendingRegistration();
  fireEvent.change(screen.getByLabelText(/^Contact Email/), { target: { value: "changed@example.com" } });
  await act(async () => pending.reject(new TypeError("Failed to fetch")));
  expect(await screen.findByText(/Could not reach the server/)).toBeTruthy();
});

it("retains a delayed field validation error when only an unrelated field changed", async () => {
  const pending = await startPendingRegistration();
  fireEvent.change(screen.getByLabelText(/^Contact Email/), { target: { value: "changed@example.com" } });
  await act(async () => pending.resolve(new Response(JSON.stringify({ error: "VALIDATION", field: "registry_url", detail: "registry_url must start with https://" }), { status: 400 })));
  const url = await screen.findByLabelText(/^AI Catalog Hosted URL/);
  expect(url.getAttribute("aria-invalid")).toBe("true");
});

it("returns a delayed unchanged handle conflict to step one after editing contact email", async () => {
  const pending = await startPendingRegistration();
  fireEvent.change(screen.getByLabelText(/^Contact Email/), { target: { value: "changed@example.com" } });
  await act(async () => pending.resolve(new Response(JSON.stringify({ error: "CONFLICT", field: "org_id", detail: "org_id already registered" }), { status: 409 })));
  expect(await screen.findByRole("heading", { name: "Identity" })).toBeTruthy();
  expect(screen.getByLabelText(/^Org ID/).getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText(/This handle is already taken/)).toBeTruthy();
});

it("does not attach a delayed conflict to a corrected handle", async () => {
  const pending = await startPendingRegistration();
  await userEvent.click(screen.getByRole("button", { name: "← Back" }));
  await userEvent.click(screen.getByRole("button", { name: "← Back" }));
  fireEvent.change(screen.getByLabelText(/^Org ID/), { target: { value: "corrected-entry" } });
  await act(async () => pending.resolve(new Response(JSON.stringify({ error: "CONFLICT", field: "org_id", detail: "org_id already registered" }), { status: 409 })));
  expect(screen.getByLabelText(/^Org ID/).getAttribute("aria-invalid")).toBe("false");
  expect(screen.queryByText(/already taken/)).toBeNull();
});

it("blocks a one-character handle on step one before checking availability", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(<NewOrgPage />);
  fireEvent.change(screen.getByLabelText(/^Org ID/), { target: { value: "a" } });
  fireEvent.change(screen.getByLabelText(/^Display Name/), { target: { value: "Valid Entry" } });
  fireEvent.change(screen.getByLabelText(/^Domain/), { target: { value: "example.com" } });
  await userEvent.click(screen.getByRole("button", { name: "Continue →" }));
  expect(screen.getByLabelText(/^Org ID/).getAttribute("aria-invalid")).toBe("true");
  expect(fetchMock).not.toHaveBeenCalled();
});


it("routes a legacy server handle validation error back to step one", async () => {
  const pending = await startPendingRegistration();
  await act(async () => pending.resolve(new Response(JSON.stringify({ error: "VALIDATION", detail: "body/org_id must NOT have fewer than 2 characters" }), { status: 400 })));
  expect(await screen.findByRole("heading", { name: "Identity" })).toBeTruthy();
  const handle = screen.getByLabelText(/^Org ID/);
  expect(handle.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(handle.getAttribute("aria-describedby")!)?.textContent).toContain("Org ID");
});

it.each([1, 2])("shows a delayed failure after navigating back to step %s", async (step) => {
  const pending = await startPendingRegistration();
  await userEvent.click(screen.getByRole("button", { name: "← Back" }));
  if (step === 1) await userEvent.click(screen.getByRole("button", { name: "← Back" }));
  await act(async () => pending.reject(new TypeError("Failed to fetch")));
  expect(await screen.findByText(/Could not reach the server/)).toBeTruthy();
});

async function fillPersonalRuntime(runtime: string) {
  render(<NewOrgPage />);
  await userEvent.click(screen.getByText(/Personal Agent/));
  fireEvent.change(screen.getByLabelText(/^Handle/), { target: { value: "personal-entry" } });
  fireEvent.change(screen.getByLabelText(/^Display Name/), { target: { value: "Personal Entry" } });
  fireEvent.change(screen.getByLabelText(/^Email Identity/), { target: { value: "owner@example.com" } });
  await userEvent.click(screen.getByRole("button", { name: "Continue →" }));
  fireEvent.change(await screen.findByLabelText(/^Agent Card URL/), { target: { value: "https://example.com/card.json" } });
  await userEvent.click(screen.getByText("Advanced runtime and authentication"));
  fireEvent.change(screen.getByLabelText(/^Runtime URL/), { target: { value: runtime } });
  await userEvent.click(screen.getByRole("button", { name: "Continue →" }));
}

it("opens the runtime disclosure for a server URL error after returning from contact", async () => {
  vi.stubGlobal("fetch", async (url: string) => url.includes("availability")
    ? new Response(JSON.stringify({ org_id_available: true }))
    : new Response(JSON.stringify({ error: "VALIDATION", detail: "extensions.org.projectnanda.runtime.url must be an absolute HTTP(S) URL" }), { status: 400 }));
  await fillPersonalRuntime("https://runtime.example.com");
  await userEvent.click(screen.getByRole("button", { name: "Register" }));
  const runtime = await screen.findByLabelText(/^Runtime URL/);
  expect(runtime.getAttribute("aria-invalid")).toBe("true");
  expect(runtime.closest("details")!.open).toBe(true);
});

it("omits a whitespace-only optional runtime URL from registration", async () => {
  let submitted: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.includes("availability")) return new Response(JSON.stringify({ org_id_available: true }));
    submitted = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ ...submitted, identifier: "urn:air:host39.org:personal:owner@example.com", domain: null, status: "pending", extensions: {} }), { status: 201 });
  });
  await fillPersonalRuntime("   ");
  await userEvent.click(screen.getByRole("button", { name: "Register" }));
  await screen.findByRole("heading", { name: "Registered", level: 2 });
  expect((submitted!.extensions as Record<string, Record<string, unknown>>)["org.projectnanda"]).not.toHaveProperty("runtime.url");
});

it("keeps an authoritative field error when a pending availability response arrives later", async () => {
  const pending = await startPendingRegistration();
  await userEvent.click(screen.getByRole("button", { name: "← Back" }));
  await userEvent.click(screen.getByRole("button", { name: "← Back" }));
  let available!: (response: Response) => void;
  vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => { available = resolve; }));
  fireEvent.blur(screen.getByLabelText(/^Domain/));
  await act(async () => pending.resolve(new Response(JSON.stringify({ error: "VALIDATION", field: "registry_url", detail: "registry_url must start with https://" }), { status: 400 })));
  const url = await screen.findByLabelText(/^AI Catalog Hosted URL/);
  expect(url.getAttribute("aria-invalid")).toBe("true");
  await act(async () => available(new Response(JSON.stringify({ org_id_available: true, domain_available: true }))));
  expect(url.getAttribute("aria-invalid")).toBe("true");
});

it("keeps a personal identity conflict when only the unrelated handle changed", async () => {
  let complete!: (response: Response) => void;
  vi.stubGlobal("fetch", (url: string) => url.includes("availability")
    ? Promise.resolve(new Response(JSON.stringify({ org_id_available: true })))
    : new Promise<Response>((resolve) => { complete = resolve; }));
  await fillPersonalRuntime("");
  await userEvent.click(screen.getByRole("button", { name: "Register" }));
  await userEvent.click(screen.getByRole("button", { name: "← Back" }));
  await userEvent.click(screen.getByRole("button", { name: "← Back" }));
  fireEvent.change(screen.getByLabelText(/^Handle/), { target: { value: "changed-handle" } });
  await act(async () => complete(new Response(JSON.stringify({ error: "CONFLICT", field: "identifier", detail: "identifier already registered" }), { status: 409 })));
  expect(screen.getByLabelText(/^Email Identity/).getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText(/This identifier is already registered/)).toBeTruthy();
});
