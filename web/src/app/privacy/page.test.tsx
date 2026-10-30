// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PrivacyPage from "./page";
import { externalLinks } from "@/lib/site-data";

const api = vi.hoisted(() => ({ getAuthProviders: vi.fn() }));
vi.mock("@/lib/nanda-api", () => ({ getAuthProviders: api.getAuthProviders }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  api.getAuthProviders.mockReset().mockResolvedValue({ google: false, github: false });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function link(href: string) {
  return Array.from(container.querySelectorAll("a")).find((a) => a.getAttribute("href") === href);
}

describe("privacy page", () => {
  it("links the contact section to the repository and its issue tracker", async () => {
    await act(async () => root.render(<PrivacyPage />));
    const repo = link(externalLinks.github);
    const issues = link(`${externalLinks.github}/issues`);
    expect(repo?.textContent).toMatch(/GitHub repository/);
    expect(issues?.textContent).toMatch(/issue/);
    for (const a of [repo!, issues!]) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toContain("noopener");
    }
  });

  it("describes sign-in as the API reports it: email and password only when no provider is on", async () => {
    await act(async () => root.render(<PrivacyPage />));
    expect(api.getAuthProviders).toHaveBeenCalledTimes(1);
    expect(container.textContent).toMatch(/an email address and a password\./);
    // Scoped to sign-in wording: the Analytics section may legitimately say "Google Analytics".
    expect(container.textContent).not.toMatch(/Google sign-in|GitHub sign-in|Google or GitHub/);
  });

  it("names a provider only when the API says it is configured", async () => {
    api.getAuthProviders.mockResolvedValue({ google: false, github: true });
    await act(async () => root.render(<PrivacyPage />));
    expect(container.textContent).toMatch(/an email address and a password, or a GitHub sign-in\./);
  });
});
