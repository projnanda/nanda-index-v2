import { describe, expect, it } from "vitest";
import { DEFAULT_API_BASE_URL, apiBaseUrl, apiDocsUrl, openApiUrl } from "./api-docs";

describe("API documentation links", () => {
  it("uses the configured API origin without a trailing slash", () => {
    expect(apiBaseUrl("http://localhost:3001/")).toBe("http://localhost:3001");
    expect(apiBaseUrl("https://api.example.org")).toBe("https://api.example.org");
  });

  it("falls back to the public API when nothing is configured", () => {
    expect(apiBaseUrl(undefined)).toBe(DEFAULT_API_BASE_URL);
    expect(apiBaseUrl("   ")).toBe(DEFAULT_API_BASE_URL);
  });

  it("points at Swagger UI and the OpenAPI document under that origin", () => {
    expect(apiDocsUrl("https://api.example.org")).toBe("https://api.example.org/docs");
    expect(openApiUrl("https://api.example.org")).toBe("https://api.example.org/docs/json");
  });
});
