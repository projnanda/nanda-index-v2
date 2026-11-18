import { expect, it } from "vitest";
import { identityStatus, cardStatus } from "./entryStatus";
import type { IndexCatalogEntry } from "./nanda-types";
const entry = (fields: Record<string, unknown>): IndexCatalogEntry => ({ identifier: "urn:air:example.org:agent:x", displayName: "Example", type: "application/a2a-agent-card+json", tags: [], updatedAt: "2026-01-01", extensions: { "org.projectnanda": fields } });
it("uses domain proof for domain entries even when their email is verified", () => {
  expect(identityStatus(entry({ domain: "example.org", emailVerified: true }))).toMatchObject({ label: "Domain not verified", checkedAt: null });
  expect(identityStatus(entry({ domain: "example.org", domainVerified: true, domainVerifiedAt: "2026-01-01" }))).toMatchObject({ label: "Domain verified", checkedAt: "2026-01-01" });
});
it("labels personal identity as email verification without promising availability", () => {
  expect(identityStatus(entry({ domain: null, emailVerified: true })).label).toBe("Email verified");
});
it("keeps unknown, invalid, and passed card checks distinct", () => {
  expect(cardStatus(null).label).toBe("Not checked");
  expect(cardStatus({ status: "invalid", checkedAt: "2026-01-01", detail: "Invalid fields" }).label).toBe("Invalid card");
  expect(cardStatus({ status: "valid", checkedAt: "2026-01-01", detail: "Required fields checked" }).label).toBe("Fetched; required fields valid");
});
