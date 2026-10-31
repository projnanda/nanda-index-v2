import { getAuthToken } from "./auth";
import type {
  IndexRecord,
  IndexCatalogEntry,
  CatalogEntry,
  ResolveResponse,
  SearchResponse,
  AgenticSearchResponse,
  User,
  CreateOrgPayload,
  UpdateOrgPayload,
  DomainChallenge,
  Availability,
} from "./nanda-types";

const API_BASE = process.env.NEXT_PUBLIC_NANDA_INDEX_API_URL ?? "";

export class ApiError extends Error {
  status: number;
  payload?: unknown;
  /** Machine-readable `error` field from the API body, when present. */
  code: string | null;

  constructor(message: string, status: number, payload?: unknown, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
    this.code = code;
  }
}

/** Server code for org writes attempted before the account email is verified. */
export const ACCOUNT_NOT_VERIFIED = "ACCOUNT_NOT_VERIFIED";

export const ACCOUNT_NOT_VERIFIED_MESSAGE =
  "Verify your email to register and manage agents. Use the link we emailed you, " +
  "or resend it from your dashboard.";

export function isAccountNotVerified(err: unknown): boolean {
  return err instanceof ApiError && err.code === ACCOUNT_NOT_VERIFIED;
}

async function parseApiResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const errorCode = typeof obj["error"] === "string" ? obj["error"] : null;
    const detail = typeof obj["detail"] === "string" ? obj["detail"] : null;
    // The verification gate can hit any org write; give every screen the same
    // human message instead of the raw code.
    const message =
      errorCode === ACCOUNT_NOT_VERIFIED ? ACCOUNT_NOT_VERIFIED_MESSAGE :
      detail && errorCode ? `${errorCode} — ${detail}` :
      detail ?? errorCode ??
      (typeof obj["message"] === "string" ? obj["message"] : `Request failed with status ${res.status}`);
    throw new ApiError(message, res.status, data, errorCode);
  }

  return data as T;
}

function authHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? getAuthToken() : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Only set Content-Type: application/json when there is a body.
  // DELETE/GET requests have no body — sending the header causes Fastify to
  // expect a JSON body and reject the request with 400 FST_ERR_CTP_EMPTY_JSON_BODY.
  const hasBody = !!init?.body;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  return parseApiResponse<T>(res);
}

/** Largest page GET /api/v1/index serves (the server caps ?limit at 500). */
const INDEX_PAGE_SIZE = 500;
/** Stop paging after this many pages so a misbehaving server can't loop us forever. */
const MAX_INDEX_PAGES = 20;

/**
 * GET /api/v1/index — every listed entry (AI Catalog entry shape). The
 * endpoint is paged (?limit/&offset), so fetch pages until a short one
 * comes back; Explore filters and paginates client-side over the full set.
 */
export async function listIndexRecords(): Promise<IndexCatalogEntry[]> {
  let entries: IndexCatalogEntry[] = [];
  for (let page = 0; page < MAX_INDEX_PAGES; page++) {
    const params = new URLSearchParams({ limit: String(INDEX_PAGE_SIZE), offset: String(page * INDEX_PAGE_SIZE) });
    const batch = await request<IndexCatalogEntry[]>(`/api/v1/index?${params}`);
    entries = [...entries, ...batch];
    if (batch.length < INDEX_PAGE_SIZE) break;
  }
  return entries;
}

/** GET /api/v1/index/:org_id — a single entry (AI Catalog entry shape). */
export async function getIndexRecord(orgId: string): Promise<IndexCatalogEntry> {
  return request<IndexCatalogEntry>(`/api/v1/index/${encodeURIComponent(orgId)}`);
}

/** GET /api/v1/search?q= — keyword search or URN lookup. Returns { query, count, results }. */
export async function searchIndexRecords(q: string): Promise<SearchResponse> {
  return request<SearchResponse>(`/api/v1/search?q=${encodeURIComponent(q)}`);
}

/**
 * GET /api/v1/agentic-search?q=&limit= — natural-language task search.
 * Ranks candidate orgs, fans out live to expand them into agent-level
 * candidates, and returns a merged, scored list ready to resolve/run.
 */
export async function agenticSearch(q: string, limit?: number): Promise<AgenticSearchResponse> {
  const params = new URLSearchParams({ q, ...(limit ? { limit: String(limit) } : {}) });
  return request<AgenticSearchResponse>(`/api/v1/agentic-search?${params}`);
}

/**
 * GET /api/v1/resolve?locator=urn:air:<publisher-FQDN>:<namespace...>:<short-name>
 * Returns the matching IndexRecord. On match "exact" registry_url is the next
 * hop itself; on match "publisher" it is the publisher's catalog, and the
 * caller looks up <identifier> (the short-name) inside it.
 */
export async function resolveAgent(locator: string): Promise<ResolveResponse> {
  return request<ResolveResponse>(`/api/v1/resolve?locator=${encodeURIComponent(locator)}`);
}

/**
 * Fetch an agent card for hop 2.
 *
 * - If mediaType is 'application/a2a-agent-card+json', registryUrl IS the card —
 *   fetch it directly.
 * - Otherwise (ai-catalog registry), append /agents/<agentId> to the base URL.
 */
export async function fetchAgentRecord(
  registryUrl: string,
  agentId: string,
  mediaType?: string,
): Promise<CatalogEntry> {
  const isDirectCard = mediaType === "application/a2a-agent-card+json" ||
    mediaType === "application/mcp-server-card+json" ||
    mediaType === "application/agentskill+zip";
  const url = isDirectCard
    ? registryUrl
    : `${registryUrl.replace(/\/+$/, "")}/agents/${encodeURIComponent(agentId)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return parseApiResponse<CatalogEntry>(res);
}

/** GET /auth/providers — which OAuth providers are configured on the server. */
export async function getAuthProviders(): Promise<{ google: boolean; github: boolean }> {
  return request<{ google: boolean; github: boolean }>('/auth/providers');
}

/** POST /auth/register — create account with email + password. Returns JWT. */
export async function registerWithPassword(
  email: string,
  password: string,
  displayName?: string,
): Promise<string> {
  const res = await request<{ token: string }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, display_name: displayName }),
  });
  return res.token;
}

/** POST /auth/login — sign in with email + password. Returns JWT. */
export async function loginWithPassword(email: string, password: string): Promise<string> {
  const res = await request<{ token: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return res.token;
}

/**
 * POST /auth/forgot-password — request a reset link.
 * Always resolves on a 200 (the server never reveals whether the email exists).
 */
export async function forgotPassword(email: string): Promise<void> {
  await request<{ ok: boolean }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/** POST /auth/reset-password — set a new password using an emailed token. */
export async function resetPassword(token: string, password: string): Promise<void> {
  await request<{ ok: boolean }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

/**
 * POST /auth/verify-account — confirm the account email with the emailed token.
 * Called on an explicit button press, never on page load (mail scanners
 * prefetch links).
 */
export async function verifyAccount(token: string): Promise<void> {
  await request<{ ok: boolean }>("/auth/verify-account", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

/** POST /auth/resend-account-verification — email a fresh verification link. */
export async function resendAccountVerification(): Promise<{ ok: boolean; already_verified?: boolean }> {
  return request<{ ok: boolean; already_verified?: boolean }>("/auth/resend-account-verification", {
    method: "POST",
  });
}

/** GET /api/v1/me — authenticated user profile + org memberships. */
export async function getMe(): Promise<User> {
  return request<User>("/api/v1/me");
}

export interface AccountSettings extends User {
  has_password: boolean;
  auth_provider: "email" | "google" | "github";
  deletion_blockers: { org_id: string; display_name: string }[];
}

export async function getAccountSettings(): Promise<AccountSettings> {
  return request<AccountSettings>("/api/v1/me");
}

export async function updateProfile(displayName: string): Promise<{ token: string; display_name: string | null }> {
  return request("/api/v1/me", { method: "PATCH", body: JSON.stringify({ display_name: displayName }) });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await request("/auth/change-password", { method: "POST", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
}

export async function logoutAll(): Promise<void> {
  await request("/auth/logout-all", { method: "POST" });
}

export async function requestAccountDeletion(): Promise<void> {
  await request("/auth/request-account-deletion", { method: "POST" });
}

export async function deleteAccount(proof: { current_password?: string; deletion_code?: string }): Promise<void> {
  await request("/api/v1/me", { method: "DELETE", body: JSON.stringify({ confirmation: "DELETE", ...proof }) });
}

/** POST /api/v1/orgs — create an org (requires auth). */
export async function createOrg(payload: CreateOrgPayload): Promise<IndexRecord> {
  return request<IndexRecord>("/api/v1/orgs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** GET /api/v1/availability — whether an org_id and/or domain is still free (requires auth). */
export async function checkAvailability(query: { org_id?: string; domain?: string }): Promise<Availability> {
  const params = new URLSearchParams(
    Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  return request<Availability>(`/api/v1/availability?${params}`);
}

/** PUT /api/v1/orgs/:org_id — update an org (requires auth). */
export async function updateOrg(orgId: string, payload: UpdateOrgPayload): Promise<IndexRecord> {
  return request<IndexRecord>(`/api/v1/orgs/${encodeURIComponent(orgId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

/** DELETE /api/v1/orgs/:org_id/suspend — suspend an org (requires auth). */
export async function suspendOrg(orgId: string): Promise<IndexRecord> {
  return request<IndexRecord>(`/api/v1/orgs/${encodeURIComponent(orgId)}/suspend`, {
    method: "DELETE",
  });
}

/** POST /api/v1/orgs/:org_id/reactivate — reactivate a suspended org (requires auth). */
export async function reactivateOrg(orgId: string): Promise<IndexRecord> {
  return request<IndexRecord>(`/api/v1/orgs/${encodeURIComponent(orgId)}/reactivate`, {
    method: "POST",
  });
}

/** DELETE /api/v1/orgs/:org_id — permanently delete an org (requires auth). */
export async function deleteOrg(orgId: string): Promise<void> {
  await request<void>(`/api/v1/orgs/${encodeURIComponent(orgId)}`, {
    method: "DELETE",
  });
}

/** GET /api/v1/orgs/:org_id — get own org (requires auth + membership). */
export async function getOrgAsOwner(orgId: string): Promise<IndexRecord> {
  return request<IndexRecord>(`/api/v1/orgs/${encodeURIComponent(orgId)}`);
}

/** POST /api/v1/verify-email — confirm a contact email with the emailed token. */
export async function verifyEmail(token: string): Promise<IndexRecord> {
  return request<IndexRecord>("/api/v1/verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

/** POST /api/v1/orgs/:org_id/resend-verification — email a new verification link (admin). */
export async function resendVerification(orgId: string): Promise<{ sent: boolean }> {
  return request<{ sent: boolean }>(`/api/v1/orgs/${encodeURIComponent(orgId)}/resend-verification`, {
    method: "POST",
  });
}

/** POST /api/v1/orgs/:org_id/domain-challenge — issue a DNS TXT challenge (admin). */
export async function requestDomainChallenge(orgId: string): Promise<DomainChallenge> {
  return request<DomainChallenge>(`/api/v1/orgs/${encodeURIComponent(orgId)}/domain-challenge`, {
    method: "POST",
  });
}

/** POST /api/v1/orgs/:org_id/verify-domain — check DNS and activate (admin). */
export async function verifyDomain(orgId: string): Promise<IndexRecord> {
  return request<IndexRecord>(`/api/v1/orgs/${encodeURIComponent(orgId)}/verify-domain`, {
    method: "POST",
  });
}

/** GET /agents on a Registry Server — returns full CatalogDocument. */
export async function listRegistryAgents(
  registryUrl: string,
): Promise<import("./nanda-types").CatalogDocument> {
  const base = registryUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/agents`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return parseApiResponse(res);
}

/** Fetch the agent facts document at hop 3 URL — may fail on CORS for external hosts. */
export async function fetchFactsUrl(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json, */*" },
    cache: "no-store",
  });
  return parseApiResponse(res);
}

/** @deprecated Use listIndexRecords. Kept for backwards compat during migration. */
export async function searchRegistries(q: string): Promise<IndexRecord[]> {
  const res = await searchIndexRecords(q);
  return res.results ?? [];
}
