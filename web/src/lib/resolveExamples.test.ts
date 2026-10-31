import { expect, it } from "vitest";
import { resolveExamples, exampleResponse } from "./resolveExamples";
it.each(["catalog", "smb", "personal"])("provides a complete controlled %s discovery chain", (kind) => {
  const origin = "https://index.example";
  const preset = resolveExamples.find((example) => example.kind === kind)!;
  const index = exampleResponse(kind, ["index"], origin) as { locator: string; entry: { url: string; type: string } };
  expect(index.locator).toBe(preset.identifier);
  const path = index.entry.type === "application/ai-catalog+json" ? ["registry", "agents", "demo"] : ["card"];
  const source = exampleResponse(kind, path, origin) as { url: string; name?: string };
  const card = path[0] === "card" ? source : exampleResponse(kind, ["card"], origin) as { url: string; name?: string };
  expect(card.name).toBeTruthy();
  expect(card.url).toBe(`${origin}/api/resolve-examples/${kind}/runtime`);
});
it("does not provide arbitrary resources or external URLs", () => {
  expect(exampleResponse("other", ["index"], "https://index.example")).toBeNull();
  expect(exampleResponse("catalog", ["private"], "https://index.example")).toBeNull();
});
