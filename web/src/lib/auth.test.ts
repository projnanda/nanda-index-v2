import { describe, expect, it } from "vitest";
import { parseJwtPayload } from "./auth";

function tokenFor(payload: unknown) {
  return `header.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.signature`;
}

const profile = { userId: "user-1", email: "user@example.org", exp: 1900000000 };

describe("parseJwtPayload", () => {
  it.each(["Name — QA Test", "Élodie García", "李明", "Agent 🧑🏽‍💻"])(
    "preserves UTF-8 display name %s",
    (displayName) => {
      expect(parseJwtPayload(tokenFor({ ...profile, displayName }))).toEqual({ ...profile, displayName });
    },
  );

  it("accepts unpadded base64url characters", () => {
    const token = tokenFor({ ...profile, displayName: "𐀿🧪" });
    expect(token.split(".")[1]).toMatch(/[-_]/);
    expect(parseJwtPayload(token)?.displayName).toBe("𐀿🧪");
  });

  it("preserves ASCII profiles and optional fields", () => {
    expect(parseJwtPayload(tokenFor({ userId: "user-1", email: "user@example.org" }))).toEqual({
      userId: "user-1", email: "user@example.org", displayName: null, exp: undefined,
    });
  });

  it.each(["", "one.two", "a.%%%.b", "a._w.b", tokenFor(null), tokenFor({ userId: 1, email: "a@b.org" })])(
    "returns null for malformed input %s",
    (token) => expect(parseJwtPayload(token)).toBeNull(),
  );
});
