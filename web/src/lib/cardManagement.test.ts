import { expect, it } from "vitest";
import { cardManagement } from "./cardManagement";

it.each(["https://host39.org/card.json", "https://agentcards.host39.org/card.json"])("offers Host39 management for %s", (url) => {
  expect(cardManagement(url)).toEqual({ url: "https://host39.org", hostedByHost39: true });
});
it.each(["https://example.org/card.json", "https://host39.org.example.org/card.json", "https://not-host39.org/card.json"])("links to the actual card host for %s", (url) => {
  expect(cardManagement(url)).toEqual({ url, hostedByHost39: false });
});
it.each([null, "invalid", "javascript:alert(1)", "https://user:pass@example.org/card.json"])("does not link unsafe or missing URLs (%s)", (url) => {
  expect(cardManagement(url)).toBeNull();
});
