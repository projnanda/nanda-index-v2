import { expect, it } from "vitest";
import { resolutionSummary } from "./resolutionStatus";
it("only reports completion when all discovery hops succeeded", () => {
  expect(resolutionSummary(["ok", "ok", "ok"])).toBe("Index, source and card fetched");
});
it.each([
  [["error", "skipped", "skipped"], "Index lookup failed at hop 1 (NANDA Index)"],
  [["ok", "error", "skipped"], "Index lookup OK · discovery failed at hop 2 (Agent Source)"],
  [["ok", "ok", "error"], "Index and source fetched · discovery failed at hop 3 (Agent Card)"],
  [["ok", "skipped", "skipped"], "Index lookup OK · discovery stopped at hop 2 (Agent Source)"],
  [["ok", "ok", "skipped"], "Index and source fetched · card fetch skipped"],
] as const)("describes partial trace %j", (states, expected) => {
  expect(resolutionSummary(states)).toBe(expected);
});
it("does not call a pending trace complete", () => {
  expect(resolutionSummary(["ok", "loading", "idle"])).toBe("Fetching hop 2 (Agent Source)…");
});
