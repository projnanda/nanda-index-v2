export type HopStatus = "idle" | "loading" | "ok" | "error" | "skipped";

/** Describe discovery evidence only; fetching a card does not test its runtime. */
export function resolutionSummary(states: readonly HopStatus[]): string {
  const labels = ["NANDA Index", "Agent Source", "Agent Card"];
  const loading = states.findIndex((status) => status === "loading");
  if (loading >= 0) return `Fetching hop ${loading + 1} (${labels[loading]})…`;
  const failed = states.findIndex((status) => status === "error");
  const prefix = states[0] !== "ok" ? "Index lookup" : states[1] !== "ok" ? "Index lookup OK · discovery" : "Index and source fetched · discovery";
  if (failed >= 0) return `${prefix} failed at hop ${failed + 1} (${labels[failed]})`;
  if (states[0] !== "ok") return "Discovery has not completed";
  if (states[1] !== "ok") return "Index lookup OK · discovery stopped at hop 2 (Agent Source)";
  if (states[2] !== "ok") return "Index and source fetched · card fetch skipped";
  return "Index, source and card fetched";
}
