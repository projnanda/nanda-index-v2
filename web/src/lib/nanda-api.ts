import { getAuthToken } from "./auth";
import type {
  IndexRecord,
  CatalogEntry,
  ResolveResponse,
  SearchResponse,
  User,
  CreateOrgPayload,
  UpdateOrgPayload,
  DomainChallenge,
} from "./nanda-types";

const API_BASE = process.env.NEXT_PUBLIC_NANDA_INDEX_API_URL ?? "";

export class ApiError extends Error {
  status: number;
  payload?: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
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
    const message =
      detail && errorCode ? `${errorCode} — ${detail}` :
      detail ?? errorCode ??
      (typeof obj["message"] === "string" ? obj["message"] : `Request failed with status ${res.status}`);
    throw new ApiError(message, res.status, data);
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

/** GET /api/v1/index — list all active orgs. */
export async function listIndexRecords(): Promise<IndexRecord[]> {
  return request<IndexRecord[]>("/api/v1/index");
}

/** GET /api/v1/index/:org_id — single IndexRecord. */
export async function getIndexRecord(orgId: string): Promise<IndexRecord> {
  return request<IndexRecord>(`/api/v1/index/${encodeURIComponent(orgId)}`);
}

/** GET /api/v1/search?q= — keyword search or URN lookup. Returns { query, count, results }. */
export async function searchIndexRecords(q: string): Promise<SearchResponse> {
  return request<SearchResponse>(`/api/v1/search?q=${encodeURIComponent(q)}`);
}

/**
 * GET /api/v1/resolve?locator=<agent>@<domain>:global
 * Returns identifier + IndexRecord from the NANDA Index.
 * The caller fetches the AgentRecord directly: GET <index_record.registry_url>/agents/<identifier>
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

/** GET /api/v1/me — authenticated user profile + org memberships. */
export async function getMe(): Promise<User> {
  return request<User>("/api/v1/me");
}

/** POST /api/v1/orgs — create an org (requires auth). */
export async function createOrg(payload: CreateOrgPayload): Promise<IndexRecord> {
  return request<IndexRecord>("/api/v1/orgs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
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

export interface CreateAgentPayload {
  agent_id: string;
  display_name: string;
  url: string;
  media_type?: string;
  description?: string;
  tags?: string[];
  version?: string;
  ttl_seconds?: number;
}

/** POST /agents on a Registry Server — requires admin token. */
export async function createRegistryAgent(
  registryUrl: string,
  adminToken: string,
  payload: CreateAgentPayload,
): Promise<CatalogEntry> {
  const base = registryUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/agents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  return parseApiResponse<CatalogEntry>(res);
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
