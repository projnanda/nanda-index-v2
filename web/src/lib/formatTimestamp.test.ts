import { describe, expect, it } from "vitest";
import { formatTimestamp } from "./formatTimestamp";

describe("formatTimestamp", () => {
  it("includes the date, time and zone used for the display", () => {
    expect(formatTimestamp("2026-07-15T16:02:39Z", "en-US", "America/New_York"))
      .toBe("7/15/2026, 12:02:39 PM EDT");
    expect(formatTimestamp("2026-01-15T16:02:39Z", "en-US", "America/New_York"))
      .toBe("1/15/2026, 11:02:39 AM EST");
    expect(formatTimestamp("2026-07-15T16:02:39Z", "en-US", "UTC"))
      .toBe("7/15/2026, 4:02:39 PM UTC");
  });

  it("handles invalid dates without showing Invalid Date", () => {
    expect(formatTimestamp("not-a-date")).toBe("Unavailable");
  });
});
