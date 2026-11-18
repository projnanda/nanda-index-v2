import { describe, expect, it } from "vitest";
import { formatTtl } from "./formatTtl";

describe("formatTtl", () => {
  it.each([
    [86400, "24 hours"],
    [3600, "1 hour"],
    [21600, "6 hours"],
    [604800, "7 days"],
    [172800, "2 days"],
    [5400, "90 minutes"],
    [90, "90 seconds"],
  ])("formats %i seconds as %s", (seconds, expected) => {
    expect(formatTtl(seconds)).toBe(expected);
  });

  it("does not invent a duration for invalid input", () => {
    expect(formatTtl(Number.NaN)).toBe("an unspecified time");
    expect(formatTtl(-1)).toBe("an unspecified time");
  });
});
