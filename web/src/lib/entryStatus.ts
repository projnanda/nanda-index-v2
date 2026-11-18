import { entryOps, nandaExtension } from "./air";
import type { CardValidation, IndexCatalogEntry } from "./nanda-types";

export function identityStatus(entry: IndexCatalogEntry): { label: string; checkedAt: string | null } {
  const ops = entryOps(entry);
  const extension = nandaExtension(entry);
  const domain = ops.domain !== null;
  const verified = domain ? ops.domainVerified : ops.emailVerified;
  const timestamp = domain ? extension.domainVerifiedAt : extension.emailVerifiedAt;
  return { label: `${domain ? "Domain" : "Email"} ${verified ? "verified" : "not verified"}`, checkedAt: verified && typeof timestamp === "string" ? timestamp : null };
}

export function cardStatus(check: CardValidation | null | undefined): { label: string; detail: string; checkedAt: string | null } {
  const labels = { valid: "Fetched; required fields valid", invalid: "Invalid card", unavailable: "Fetch failed", not_checked: "Not checked" };
  return { label: check ? labels[check.status] ?? "Not checked" : "Not checked", detail: check?.detail ?? "No card validation result is recorded.", checkedAt: check?.checkedAt ?? null };
}

export function entryCardStatus(entry: IndexCatalogEntry) {
  const raw = nandaExtension(entry).cardValidation;
  if (!raw || typeof raw !== "object" || !("status" in raw)) return cardStatus(null);
  return cardStatus(raw as CardValidation);
}
