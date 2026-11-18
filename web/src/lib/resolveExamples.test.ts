import { expect, it } from "vitest";
import { resolveExamples, exampleResponse } from "./resolveExamples";
it.each(["catalog", "smb", "personal"])("provides a complete controlled %s discovery chain", (kind) => {
  const preset = resolveExamples.find((example) => example.kind === kind)!;
  const index = exampleResponse(kind, ["index"]) as { locator: string; entry: { url: string; type: string } };
  expect(index.locator).toBe(preset.identifier);
  const path = index.entry.type === "application/ai-catalog+json" ? ["registry", "agents", "demo"] : ["card"];
  const source = exampleResponse(kind, path) as { url: string; name?: string };
  const card = path[0] === "card" ? source : exampleResponse(kind, ["card"]) as { url: string; name?: string };
  expect(card.name).toBeTruthy();
  expect(card.url).toBe(`/api/resolve-examples/${kind}/runtime`);
});
it("does not provide arbitrary resources or external URLs", () => {
  expect(exampleResponse("other", ["index"])).toBeNull();
  expect(exampleResponse("catalog", ["private"])).toBeNull();
});
