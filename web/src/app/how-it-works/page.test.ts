import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HowItWorksPage from "./page";

/**
 * The page must tell each deployment context what the index requires before
 * an entry is published, matching the server: an entry with a domain is
 * hidden until a DNS TXT record proves the domain (confirming the contact
 * email does not publish it); a personal entry (no domain) is published once
 * its email is confirmed.
 */
const DOMAIN_CONTEXTS = ["enterprise-ai-catalog", "dns-svcb", "smb-agent-card"];
const PERSONAL_CONTEXT = "personal-agent";

function contextText(html: string, id: string): string {
  const match = html.match(new RegExp(`<section[^>]*id="${id}"[^>]*>([\\s\\S]*?)</section>`));
  expect(match, `section #${id}`).not.toBeNull();
  return match![1].replace(/<[^>]+>/g, " ");
}

describe("how it works: going live", () => {
  const html = renderToStaticMarkup(createElement(HowItWorksPage));

  it("tells every domain-anchored context that the entry stays hidden until its DNS TXT record is found", () => {
    for (const id of DOMAIN_CONTEXTS) {
      const text = contextText(html, id);
      expect(text, id).toMatch(/To go live:/);
      expect(text, id).toMatch(/DNS TXT record/);
      expect(text, id).toMatch(/pending and hidden/);
      // Email confirmation is asked for but, unlike the TXT record, does not publish a domain entry.
      expect(text, id).toMatch(/contact email too/i);
    }
  });

  it("tells the personal context that only email confirmation is needed", () => {
    const text = contextText(html, PERSONAL_CONTEXT);
    expect(text).toMatch(/To go live:/);
    expect(text).toMatch(/email/i);
    expect(text).toMatch(/no DNS record/i);
    expect(text).not.toMatch(/TXT record/);
  });

  it("separates the ownership record from the SMB and SVCB discovery records", () => {
    expect(contextText(html, "smb-agent-card")).toMatch(/No agent-discovery DNS records/);
    expect(contextText(html, "dns-svcb")).toMatch(/separate from the SVCB records/);
  });
});
