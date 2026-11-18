import { NANDA_EXTENSION } from "./air";
import type { CatalogExtensions } from "./nanda-types";

export const RUNTIME_PROVIDERS = ["AWS", "Azure", "GCP", "Railway", "GoDaddy", "Vercel", "Other"];

export const RUNTIME_FIELDS = [
  { key: "runtime.provider", label: "Runtime provider", help: "runtime_provider" },
  { key: "runtime.url", label: "Runtime URL", help: "runtime_url" },
  { key: "auth.metadata", label: "Auth metadata", help: "auth_metadata" },
  { key: "auth.execution", label: "Auth execution", help: "auth_execution" },
] as const;
export type RuntimeSettings = Record<typeof RUNTIME_FIELDS[number]["key"], string>;

export function readRuntimeSettings(extensions: CatalogExtensions): RuntimeSettings {
  const hints = extensions[NANDA_EXTENSION] ?? {};
  return Object.fromEntries(RUNTIME_FIELDS.map(({ key }) => [key, typeof hints[key] === "string" ? hints[key] : ""])) as RuntimeSettings;
}

/** The API replaces extensions, so retain every field not edited by this form. */
export function applyRuntimeSettings(extensions: CatalogExtensions, settings: RuntimeSettings): CatalogExtensions {
  const hints = { ...extensions[NANDA_EXTENSION] };
  for (const { key } of RUNTIME_FIELDS) {
    if (settings[key].trim()) hints[key] = settings[key].trim();
    else delete hints[key];
  }
  return { ...extensions, [NANDA_EXTENSION]: hints };
}
