import { describe, expect, it } from "vitest";
import { ApiError } from "./nanda-api";
import { orgFormError, validateOrgFields } from "./org-validation";

describe("shared organization validation", () => {
  it.each(["https://", "not-a-url", "javascript:alert(1)", "ftp://example.com"])("rejects malformed or unsupported URLs: %s", (url) => {
    expect(validateOrgFields({ registry_url: url, runtime_url: url })).toHaveProperty("registry_url");
    expect(validateOrgFields({ registry_url: url, runtime_url: url })).toHaveProperty("runtime_url");
  });
  it("allows HTTP development URLs, HTTPS and omitted optional hints", () => {
    expect(validateOrgFields({ registry_url: "http://localhost:8000/card.json", runtime_url: "", version: "release-2026" })).toEqual({});
    expect(validateOrgFields({ registry_url: "https://example.com/card.json", ttl_seconds: "3600" })).toEqual({});
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
  it("gives network errors a retry action without implementation details", () => {
    expect(orgFormError(new TypeError("Failed to fetch"))).toEqual({ fields: {}, message: "Could not reach the server. Check your connection and try again." });
  });
});
