// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DevelopersPage, { metadata } from "./page";
import { Footer } from "@/components/Footer";
import { apiBaseUrl } from "@/lib/api-docs";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
});

function links() {
  return Array.from(container.querySelectorAll("a"));
}

describe("developers page", () => {
  it("links the interactive API reference and OpenAPI document under the configured API origin", async () => {
    await act(async () => root.render(<DevelopersPage />));
    const base = apiBaseUrl();
    const swagger = links().find((a) => a.getAttribute("href") === `${base}/docs`);
    const openapi = links().find((a) => a.getAttribute("href") === `${base}/docs/json`);
    expect(swagger?.textContent).toMatch(/Swagger/);
    expect(openapi?.textContent).toMatch(/OpenAPI/);
    for (const a of [swagger!, openapi!]) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toContain("noopener");
    }
  });

  it("sends every curl example to the same API origin", async () => {
    await act(async () => root.render(<DevelopersPage />));
    const base = apiBaseUrl();
    // The request target is the URL on the curl line itself; URLs inside
    // example bodies (a registrant's own registry_url) are not API calls.
    const targets = Array.from(container.querySelectorAll("pre"))
      .flatMap((pre) => (pre.textContent ?? "").split("\n"))
      .filter((line) => line.trimStart().startsWith("curl"))
      .map((line) => line.match(/https?:\/\/[^\s"']+/)?.[0]);
    expect(targets.length).toBeGreaterThanOrEqual(10);
    for (const url of targets) {
      expect(url, "curl line without a URL").toBeDefined();
      expect(url!.startsWith(`${base}/`), url).toBe(true);
    }
  });

  it("walks register, verify, update and delete in that order", async () => {
    await act(async () => root.render(<DevelopersPage />));
    const steps = Array.from(container.querySelectorAll("ol li h3")).map((h) => h.textContent ?? "");
    const order = ["Create an account", "Register an entry", "Verify and go live", "Update", "Suspend, reactivate or delete"].map((s) =>
      steps.findIndex((step) => step.startsWith(s)),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("follows a configured API origin for the reference links and every curl target", async () => {
    vi.stubEnv("NEXT_PUBLIC_NANDA_INDEX_API_URL", "https://api.example.test/");
    await act(async () => root.render(<DevelopersPage />));
    expect(links().find((a) => a.textContent?.includes("Swagger"))?.getAttribute("href")).toBe("https://api.example.test/docs");
    expect(links().find((a) => a.textContent?.includes("OpenAPI"))?.getAttribute("href")).toBe("https://api.example.test/docs/json");
    const targets = Array.from(container.querySelectorAll("pre"))
      .flatMap((pre) => (pre.textContent ?? "").split("\n"))
      .filter((line) => line.trimStart().startsWith("curl"))
      .map((line) => line.match(/https?:\/\/[^\s"']+/)?.[0]);
    expect(targets.length).toBeGreaterThanOrEqual(10);
    for (const url of targets) expect(url!.startsWith("https://api.example.test/"), url).toBe(true);
  });

  it("keeps one h1, makes code blocks keyboard-reachable, and lists rate limits and error codes", async () => {
    await act(async () => root.render(<DevelopersPage />));
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toBe("Developers");
    const blocks = Array.from(container.querySelectorAll("pre"));
    expect(blocks.length).toBeGreaterThan(0);
    for (const pre of blocks) expect(pre.getAttribute("tabindex")).toBe("0");
    const text = container.textContent ?? "";
    expect(text).toMatch(/120 requests per minute/);
    expect(text).toMatch(/ACCOUNT_NOT_VERIFIED/);
    expect(text).toMatch(/invalid_locator/);
    expect(metadata.title).toEqual({ absolute: "Developers - NANDA Index" });
  });
});

describe("footer", () => {
  it("links the Developers page and the API reference", async () => {
    await act(async () => root.render(<Footer />));
    expect(links().find((a) => a.getAttribute("href") === "/developers")?.textContent).toBe("Developers");
    const docs = links().find((a) => a.getAttribute("href") === `${apiBaseUrl()}/docs`);
    expect(docs?.textContent).toMatch(/API reference/);
    expect(docs?.getAttribute("rel")).toContain("noopener");
  });
});
