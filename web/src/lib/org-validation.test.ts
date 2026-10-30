import { describe, expect, it } from "vitest";
import { ACCOUNT_NOT_VERIFIED, ACCOUNT_NOT_VERIFIED_MESSAGE, ApiError } from "./nanda-api";
import { orgFormError, validateOrgFields } from "./org-validation";

describe("shared organization validation", () => {
  it.each(["https://", "not-a-url", "javascript:alert(1)", "ftp://example.com"])("rejects malformed or unsupported URLs: %s", (url) => {
    expect(validateOrgFields({ registry_url: url, runtime_url: url })).toHaveProperty("registry_url");
    expect(validateOrgFields({ registry_url: url, runtime_url: url })).toHaveProperty("runtime_url");
  });
  it.each([
    "https:runtime.example.com/run", "http:/runtime.example.com/run", "https:///runtime.example.com/run",
    "https://\\runtime.example.com/run", "https://runtime.example.com\\run",
    "https://runtime.exam\nple.com/run", "https://runtime.example.com/run now",
  ])("rejects URLs a URL parser would repair: %s", (url) => {
    expect(validateOrgFields({ registry_url: url, runtime_url: url })).toEqual({
      registry_url: "Enter a valid URL starting with http:// or https://.",
      runtime_url: "Enter a valid URL starting with http:// or https://.",
    });
  });
  it("allows HTTP development URLs, HTTPS and omitted optional hints", () => {
    expect(validateOrgFields({ registry_url: "http://localhost:8000/card.json", runtime_url: "", version: "release-2026" })).toEqual({});
    expect(validateOrgFields({ registry_url: "https://example.com/card.json", ttl_seconds: "3600" })).toEqual({});
    expect(validateOrgFields({ registry_url: " HTTPS://example.com/card.json ", runtime_url: "   " })).toEqual({});
  });
  it.each(["", "a", "a".repeat(65), "Ab", "-ab", "ab-", "a b", "a_b", " ab", "ab "])("rejects an org ID outside the server rules: %j", (orgId) => {
    expect(validateOrgFields({ org_id: orgId })).toHaveProperty("org_id");
  });
  it.each(["ab", "a0", "0a", "agent-runtime", "a--b", "a".repeat(64)])("accepts a valid org ID: %s", (orgId) => {
    expect(validateOrgFields({ org_id: orgId })).toEqual({});
  });
  it("preserves URL-less existing records only when explicitly allowed", () => {
    expect(validateOrgFields({ registry_url: "" })).toHaveProperty("registry_url");
    expect(validateOrgFields({ registry_url: "" }, { allowEmptyRegistryUrl: true })).toEqual({});
  });
  it("matches server field bounds and rejects whitespace-only names", () => {
    expect(validateOrgFields({ display_name: "   ", description: "x".repeat(1001), version: "x".repeat(65), ttl_seconds: "3600.5", tags: "x".repeat(65) })).toEqual({ display_name: "Required.", description: "Max 1000 characters.", version: "Max 64 characters.", ttl_seconds: "Use a whole number from 3600 to 604800 seconds.", tags: "Each tag must be at most 64 characters." });
    expect(validateOrgFields({ tags: Array(21).fill("tag").join(","), ttl_seconds: "604801" })).toHaveProperty("tags");
  });
  it("maps structured and legacy API fields without leaking codes", () => {
    expect(orgFormError(new ApiError("VALIDATION", 400, { detail: "registry_url must start with https://" }))).toEqual({ fields: { registry_url: "Enter a valid URL starting with http:// or https://." }, message: null });
    expect(orgFormError(new ApiError("VALIDATION", 400, { field: "description", detail: "Too long." }))).toEqual({ fields: { description: "Too long." }, message: null });
  });
  it("keeps the shared account-verification message ahead of field or raw-detail mapping", () => {
    const error = new ApiError(ACCOUNT_NOT_VERIFIED_MESSAGE, 403, {
      error: ACCOUNT_NOT_VERIFIED, field: "domain", detail: "account email must be verified before writing organizations",
    }, ACCOUNT_NOT_VERIFIED);
    expect(orgFormError(error)).toEqual({ fields: {}, message: ACCOUNT_NOT_VERIFIED_MESSAGE });
  });
  it("maps org ID schema errors to the identifier field", () => {
    expect(orgFormError(new ApiError("VALIDATION", 400, {
      detail: "body/org_id must NOT have fewer than 2 characters",
    }))).toEqual({ fields: { org_id: "Org ID must NOT have fewer than 2 characters" }, message: null });
    expect(orgFormError(new ApiError("CONFLICT", 409, {
      field: "org_id", detail: "This handle is already taken.",
    }))).toEqual({ fields: { org_id: "This handle is already taken." }, message: null });
  });
  it("prefers a structured field over a field named in legacy detail text", () => {
    expect(orgFormError(new ApiError("VALIDATION", 400, {
      field: "description", detail: "tags must contain at most 20 items",
    }))).toEqual({ fields: { description: "tags must contain at most 20 items" }, message: null });
  });
  it.each([undefined, "tags"])("turns an indexed tag error into a clear field message with field %s", (field) => {
    expect(orgFormError(new ApiError("VALIDATION", 400, {
      field, detail: "body/tags/0 must NOT have more than 64 characters",
    }))).toEqual({ fields: { tags: "Tags: each tag must be at most 64 characters." }, message: null });
  });
  it.each([
    { detail: "extensions.org.projectnanda.runtime.url must be an absolute HTTP(S) URL" },
    { detail: "body/extensions.org.projectnanda.runtime.url must be an absolute HTTP(S) URL" },
    { field: "extensions.org.projectnanda.runtime.url", detail: "must be an absolute HTTP(S) URL" },
  ])("maps the runtime extension URL error to the form field: %j", (payload) => {
    expect(orgFormError(new ApiError("VALIDATION", 400, payload))).toEqual({
      fields: { runtime_url: "Enter a valid URL starting with http:// or https://." }, message: null,
    });
  });
  it("uses the visible Version label in API field messages", () => {
    expect(orgFormError(new ApiError("VALIDATION", 400, {
      detail: "body/version must NOT have more than 64 characters",
    }))).toEqual({ fields: { version: "Version label must NOT have more than 64 characters" }, message: null });
  });
  it("gives network errors a retry action without implementation details", () => {
    expect(orgFormError(new TypeError("Failed to fetch"))).toEqual({ fields: {}, message: "Could not reach the server. Check your connection and try again." });
  });
});
