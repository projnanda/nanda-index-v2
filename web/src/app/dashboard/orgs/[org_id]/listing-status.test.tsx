// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { formatTimestamp } from "@/lib/formatTimestamp";
import OrgDetailPage from "./page";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), useParams: () => ({ org_id: "acme" }) }));
vi.mock("@/hooks/useRequireAuth", () => ({ useRequireAuth: () => {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const BASE = { org_id: "acme", display_name: "Acme", domain: "acme.com", registry_url: "https://acme.com/.well-known/ai-catalog.json",
  ttl_seconds: 86400, status: "active", email_verified: true, email_verified_at: "2026-10-01T09:00:00Z",
  domain_verified: true, domain_verified_at: "2026-10-02T10:00:00Z", moderation: "none",
  created_at: "2026-09-30T12:00:00Z", updated_at: "2026-11-05T08:30:00Z", identifier: "urn:air:acme.com:catalog:root", extensions: {} };

async function renderStatus(overrides: Record<string, unknown> = {}) {
  const challenge = { domain: "acme.com", record_name: "_nanda-challenge.acme.com", record_type: "TXT",
    record_value: "nanda-verify=token", expires_at: "2026-11-12T00:00:00Z" };
  vi.stubGlobal("fetch", async (url: string) =>
    new Response(JSON.stringify(url.endsWith("/domain-challenge") ? challenge : { ...BASE, ...overrides })));
  render(<OrgDetailPage />);
  return screen.findByRole("region", { name: "Listing status" });
}

it("shows an active listing's status, verification times, last update and what the TTL means", async () => {
  const section = await renderStatus();
  const text = section.textContent ?? "";
  expect(text).toMatch(/Listed in the public index/);
  expect(within(section).getByText(`Verified ${formatTimestamp(BASE.domain_verified_at)}`)).toBeTruthy();
  expect(within(section).getByText(`Verified ${formatTimestamp(BASE.email_verified_at)}`)).toBeTruthy();
  expect(within(section).getByText(formatTimestamp(BASE.updated_at))).toBeTruthy();
  expect(text).toMatch(/Resolvers may cache this record for 24 hours/);
  // There is no listing expiry, so the panel must not invent a renewal date.
  expect(text).toMatch(/Listings do not expire/);
  expect(text).not.toMatch(/renewal due|expires on/i);
});

it("explains that a pending entry is not listed until it is verified", async () => {
  const section = await renderStatus({ status: "pending", domain_verified: false, domain_verified_at: null, email_verified: false, email_verified_at: null });
  expect(section.textContent).toMatch(/Not listed yet/);
  expect(within(section).getAllByText("Not verified")).toHaveLength(2);
});

it("shows a verified state without a time when the record predates verification timestamps", async () => {
  const section = await renderStatus({ domain_verified_at: null, email_verified_at: null });
  expect(within(section).getAllByText("Verified")).toHaveLength(2);
});

it("reports suspension and operator moderation in words, not only colour", async () => {
  const suspended = await renderStatus({ status: "suspended" });
  expect(suspended.textContent).toMatch(/Not listed: suspended/);
  cleanup();
  const hidden = await renderStatus({ moderation: "hidden" });
  expect(hidden.textContent).toMatch(/Hidden by an index operator/);
});

it("omits the domain row for personal entries and formats a custom TTL", async () => {
  const section = await renderStatus({ domain: null, domain_verified: false, domain_verified_at: null, ttl_seconds: 21600 });
  expect(within(section).queryByText("Domain")).toBeNull();
  expect(section.textContent).toMatch(/Resolvers may cache this record for 6 hours/);
});
