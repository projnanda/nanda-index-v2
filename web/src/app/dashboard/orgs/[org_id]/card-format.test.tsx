// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrgDetailPage from "./page";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), useParams: () => ({ org_id: "mailbox-entry" }) }));
vi.mock("@/hooks/useRequireAuth", () => ({ useRequireAuth: () => {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const A2A = "application/a2a-agent-card+json";
const MCP = "application/mcp-server-card+json";
const MISMATCH = `Card matches ${A2A}, but the registration declares ${MCP}. An entry administrator can correct media_type and re-run validation.`;
const VALID = { status: "valid", checkedAt: "2026-11-05T12:00:00Z", detail: "Card fetched; required discovery fields are present." };
const HINT = /change its card format/;
const org = { org_id: "mailbox-entry", display_name: "Mailbox Entry", domain: null, media_type: MCP,
  registry_url: "https://mail.example.com/agents/lee", ttl_seconds: 86400, status: "active", email_verified: true,
  domain_verified: false, identifier: "urn:air:host39.org:personal:lee@example.com", created_at: "2026-11-01T12:00:00Z", updated_at: "2026-11-01T12:00:00Z",
  card_validation: { status: "invalid", checkedAt: "2026-11-01T12:00:00Z", detail: MISMATCH },
  extensions: { "org.projectnanda": { resolutionRole: "personal-agent-card" } } };

type Body = Record<string, unknown>;
/** Serves `read()` for reads and records each PUT body; `onPut` builds the PUT response. */
function stubApi(read: Body | (() => Body), onPut: (body: Body, attempt: number) => Response) {
  const puts: Body[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    if (init.method !== "PUT") return new Response(JSON.stringify(typeof read === "function" ? read() : read));
    const body = JSON.parse(init.body as string) as Body;
    puts.push(body);
    return onPut(body, puts.length);
  });
  return puts;
}
const formatSelect = () => screen.getByRole("combobox", { name: /^Card format/ }) as HTMLSelectElement;

it("shows the declared card format, the latest card check, and how to fix a mismatch", async () => {
  stubApi(org, () => new Response(JSON.stringify(org)));
  render(<OrgDetailPage />);
  expect(await screen.findByText("MCP server card")).toBeTruthy();
  expect(screen.getByText(/Card check: Invalid card/)).toBeTruthy();
  expect(screen.getByText(MISMATCH)).toBeTruthy();
  expect(screen.getByText(HINT)).toBeTruthy();
});

it("corrects the card format from the edit form and shows the recheck result", async () => {
  const puts = stubApi(org, (body) => new Response(JSON.stringify({ ...org, ...body, card_validation: VALID })));
  render(<OrgDetailPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
  expect(formatSelect().value).toBe(MCP);
  await userEvent.selectOptions(formatSelect(), A2A);
  // The stored check already fails, so switching needs no warning.
  expect(screen.queryByRole("status")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: "Edit" });
  expect(puts).toHaveLength(1);
  expect(puts[0]).toMatchObject({ media_type: A2A });
  // The stored URL is rechecked server-side; resending it would be a URL edit.
  expect(puts[0]).not.toHaveProperty("registry_url");
  expect(screen.getByText("A2A agent card")).toBeTruthy();
  expect(screen.getByText(/Card check: Fetched; required fields valid/)).toBeTruthy();
  expect(screen.queryByText(HINT)).toBeNull();
});

it("sends a new URL and format together so the server checks the pair", async () => {
  const puts = stubApi(org, (body) => new Response(JSON.stringify({ ...org, ...body, card_validation: VALID })));
  render(<OrgDetailPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText(/^Catalog \/ Agent Card URL/), { target: { value: "https://mail.example.com/agents/lee/card" } });
  await userEvent.selectOptions(formatSelect(), A2A);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: "Edit" });
  expect(puts[0]).toMatchObject({ media_type: A2A, registry_url: "https://mail.example.com/agents/lee/card" });
});

it("leaves media_type out when the format is unchanged, including after a canceled change", async () => {
  const puts = stubApi(org, (body) => new Response(JSON.stringify({ ...org, ...body })));
  render(<OrgDetailPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
  await userEvent.selectOptions(formatSelect(), A2A);
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("MCP server card")).toBeTruthy();
  expect(screen.queryByText("A2A agent card")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(formatSelect().value).toBe(MCP);
  fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: "Mailbox for Lee" } });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: "Edit" });
  expect(puts).toHaveLength(1);
  expect(puts[0]).toMatchObject({ description: "Mailbox for Lee" });
  expect(puts[0]).not.toHaveProperty("media_type");
});

it("warns before switching away from a format whose card check passes", async () => {
  stubApi({ ...org, media_type: A2A, card_validation: VALID }, (body) => new Response(JSON.stringify({ ...org, ...body })));
  render(<OrgDetailPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
  expect(screen.queryByRole("status")).toBeNull();
  await userEvent.selectOptions(formatSelect(), MCP);
  expect(screen.getByRole("status").textContent).toMatch(/passes its check as an A2A agent card/);
  await userEvent.selectOptions(formatSelect(), A2A);
  expect(screen.queryByRole("status")).toBeNull();
});

it.each(["application/ai-catalog+json", "application/ai-registry+json", undefined])(
  "offers no card format choice for %s entries", async (mediaType) => {
    const record = { ...org, media_type: mediaType, card_validation: null, extensions: { "org.projectnanda": { resolutionRole: "nested-ai-catalog" } } };
    const puts = stubApi(record, (body) => new Response(JSON.stringify({ ...record, ...body })));
    render(<OrgDetailPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.queryByRole("combobox", { name: /^Card format/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Edit" });
    expect(screen.queryByText(/Card check:/)).toBeNull();
    expect(puts[0]).not.toHaveProperty("media_type");
  },
);

it("reloads the entry but keeps the draft when the card changed during the check", async () => {
  const detail = "The card or entry profile changed during validation. Fetch the current record and retry your update.";
  // A concurrent edit added an extension; the retry must build on it, not on the stale copy.
  const concurrent = { ...org, extensions: { ...org.extensions, "com.example": { tier: "gold" } } };
  let current: Body = org;
  const puts = stubApi(() => current, (body, attempt) => {
    if (attempt === 1) { current = concurrent; return new Response(JSON.stringify({ error: "CARD_CHANGED", detail }), { status: 409 }); }
    return new Response(JSON.stringify({ ...concurrent, ...body, card_validation: VALID }));
  });
  render(<OrgDetailPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
  await userEvent.selectOptions(formatSelect(), A2A);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/changed while its card was being checked/);
  expect(formatSelect().value).toBe(A2A);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: "Edit" });
  expect(puts).toHaveLength(2);
  expect(puts[1]).toMatchObject({ media_type: A2A, extensions: { "com.example": { tier: "gold" } } });
});
