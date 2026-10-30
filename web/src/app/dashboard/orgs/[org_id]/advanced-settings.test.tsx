// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrgDetailPage from "./page";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), useParams: () => ({ org_id: "personal-entry" }) }));
vi.mock("@/hooks/useRequireAuth", () => ({ useRequireAuth: () => {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("edits TTL and runtime hints without dropping other extensions, and discards canceled edits", async () => {
  const org = { org_id: "personal-entry", display_name: "Personal Entry", domain: null,
    registry_url: "https://example.com/card.json", ttl_seconds: 21600, status: "active", email_verified: true,
    domain_verified: false, identifier: "urn:air:host39.org:personal:lee@example.com", created_at: "2026-10-30T12:00:00Z", updated_at: "2026-10-30T12:00:00Z",
    extensions: { "org.projectnanda": { resolutionRole: "personal-agent-card", "runtime.provider": "Custom Cloud", "runtime.url": "https://runtime.example.com", "auth.execution": "user_consent_required", extra: true }, "com.example": { tier: "gold" } } };
  let saved: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    if (init.method === "PUT") { saved = JSON.parse(init.body as string); return new Response(JSON.stringify({ ...org, ...saved })); }
    return new Response(JSON.stringify(org));
  });
  render(<OrgDetailPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
  const ttl = screen.getByLabelText(/^Cache TTL/) as HTMLInputElement;
  expect(ttl.value).toBe("21600");
  expect(ttl.closest("details")!.open).toBe(false);
  await userEvent.click(screen.getByText("Advanced settings"));
  expect((screen.getByLabelText(/^Runtime provider/) as HTMLInputElement).value).toBe("Custom Cloud");
  fireEvent.change(ttl, { target: { value: "3600" } });
  fireEvent.change(screen.getByLabelText(/^Runtime URL/), { target: { value: "" } });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: "Edit" });
  expect(saved).toMatchObject({ ttl_seconds: 3600, extensions: { "com.example": { tier: "gold" }, "org.projectnanda": { extra: true, "runtime.provider": "Custom Cloud", "auth.execution": "user_consent_required" } } });
  expect((saved!.extensions as Record<string, Record<string, unknown>>)["org.projectnanda"]).not.toHaveProperty("runtime.url");
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText(/^Cache TTL/), { target: { value: "999" } });
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect((screen.getByLabelText(/^Cache TTL/) as HTMLInputElement).value).toBe("3600");
});
