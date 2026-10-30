import { ApiError } from "./nanda-api";

export type OrgFormField = "display_name" | "domain" | "registry_url" | "description" | "tags" | "version" | "runtime_url" | "ttl_seconds";
export type OrgFormValues = Partial<Record<OrgFormField, string>>;
export type OrgFieldErrors = Partial<Record<OrgFormField, string>>;
export const URL_ERROR = "Enter a valid URL starting with http:// or https://.";
const FIELD_LABELS: Record<OrgFormField, string> = {
  display_name: "Display name", domain: "Domain", registry_url: "Catalog or agent card URL",
  description: "Description", tags: "Tags", version: "Version", runtime_url: "Runtime URL", ttl_seconds: "Cache TTL",
};
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
function validHttpUrl(value: string): boolean {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !!url.hostname; }
  catch { return false; }
}

/** Validate only supplied fields, so create steps and edit use the same rules. */
export function validateOrgFields(values: OrgFormValues, options: { allowEmptyRegistryUrl?: boolean } = {}): OrgFieldErrors {
  const errors: OrgFieldErrors = {};
  if (values.display_name !== undefined && !values.display_name.trim()) errors.display_name = "Required.";
  if (values.domain !== undefined && !DOMAIN_RE.test(values.domain.trim())) errors.domain = "Enter a valid domain (e.g., moonbakery.com).";
  if (values.registry_url !== undefined && !(options.allowEmptyRegistryUrl && !values.registry_url.trim()) && !validHttpUrl(values.registry_url.trim())) errors.registry_url = URL_ERROR;
  if (values.runtime_url?.trim() && !validHttpUrl(values.runtime_url.trim())) errors.runtime_url = URL_ERROR;
  for (const [field, max] of [["display_name", 255], ["domain", 255], ["registry_url", 512], ["description", 1000], ["version", 64]] as const) {
    if ((values[field]?.length ?? 0) > max) errors[field] = `Max ${max} characters.`;
  }
  if (values.tags !== undefined) {
    const tags = values.tags.split(",").map((tag) => tag.trim()).filter(Boolean);
    if (tags.length > 20) errors.tags = "Use at most 20 tags.";
    else if (tags.some((tag) => tag.length > 64)) errors.tags = "Each tag must be at most 64 characters.";
  }
  if (values.ttl_seconds !== undefined) {
    const ttl = Number(values.ttl_seconds);
    if (!Number.isInteger(ttl) || ttl < 3600 || ttl > 604800) errors.ttl_seconds = "Use a whole number from 3600 to 604800 seconds.";
  }
  return errors;
}

export function orgFormError(error: unknown): { fields: OrgFieldErrors; message: string | null } {
  if (!(error instanceof ApiError)) return { fields: {}, message: error instanceof TypeError
    ? "Could not reach the server. Check your connection and try again."
    : "Could not save your changes. Please try again." };
  const payload = error.payload && typeof error.payload === "object" ? error.payload as Record<string, unknown> : {};
  const detail = typeof payload.detail === "string" ? payload.detail : "";
  const candidate = typeof payload.field === "string" ? payload.field : /^(?:body\/)?([a-z_]+)(?:\b|\/)/.exec(detail)?.[1];
  if (candidate && Object.hasOwn(FIELD_LABELS, candidate)) {
    const field = candidate as OrgFormField;
    const message = error.status === 400 && (field === "registry_url" || field === "runtime_url") && /https?:\/\//.test(detail)
      ? URL_ERROR : detail.replace(/^body\//, "").replace(new RegExp(`^${field}\\b`), FIELD_LABELS[field]) || `Please check ${FIELD_LABELS[field].toLowerCase()}.`;
    return { fields: { [field]: message }, message: null };
  }
  return { fields: {}, message: detail || (error.status === 401 ? "Your session has expired. Sign in again." : "Could not save your changes. Please try again.") };
}
