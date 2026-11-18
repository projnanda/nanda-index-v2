import { describe, expect, it } from "vitest";
import { noUrlExplanation, svcbPointerDomain } from "./svcbPointer";
import type { IndexCatalogEntry } from "./nanda-types";

function entry(identifier: string, nanda: Record<string, unknown>): IndexCatalogEntry {
  return { identifier, displayName: "x", type: "application/a2a-agent-card+json",
    extensions: { "org.projectnanda": nanda } } as unknown as IndexCatalogEntry;
}

const FLIGHTS = "urn:air:flights.travel26.net:agent:travel26-flights";

describe("svcbPointerDomain", () => {
  it("returns the registered domain of a DNS SVCB pointer", () => {
    expect(svcbPointerDomain(entry(FLIGHTS, { resolutionRole: "dns-svcb-pointer", domain: "Flights.Travel26.net" })))
      .toBe("flights.travel26.net");
  });

  it("falls back to the URN's publisher domain", () => {
    expect(svcbPointerDomain(entry(FLIGHTS, { resolutionRole: "dns-svcb-pointer" }))).toBe("flights.travel26.net");
  });

  it("is null for any other resolution role", () => {
    expect(svcbPointerDomain(entry(FLIGHTS, { resolutionRole: "smb-agent-card" }))).toBeNull();
    expect(svcbPointerDomain(entry(FLIGHTS, {}))).toBeNull();
  });
});

describe("noUrlExplanation", () => {
  it("explains DNS SVCB discovery instead of the generic dead-end (#55)", () => {
    const text = noUrlExplanation(entry(FLIGHTS, { resolutionRole: "dns-svcb-pointer" }));
    expect(text).toContain("discovered via DNS SVCB");
    expect(text).toContain("dig flights.travel26.net SVCB");
  });

  it("keeps the generic message for other entries without a URL", () => {
    expect(noUrlExplanation(entry("urn:air:a.com:agent:x", { resolutionRole: "smb-agent-card" })))
      .toBe("No URL to follow — inline data or custom discovery path.");
  });
});
